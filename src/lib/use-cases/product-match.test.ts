import { describe, expect, it, beforeEach, vi } from "vitest"

const {
    mockGetContificoConfig,
    mockGetContificoService,
    mockGetAllProductos,
    mockLogContificoEvent,
} = vi.hoisted(() => ({
    mockGetContificoConfig: vi.fn(),
    mockGetContificoService: vi.fn(),
    mockGetAllProductos: vi.fn(),
    mockLogContificoEvent: vi.fn(),
}))

vi.mock("../../api/admin/contifico/shared", () => ({
    getContificoConfig: mockGetContificoConfig,
    getContificoService: mockGetContificoService,
}))

vi.mock("../client", () => ({
    ContificoClient: vi.fn().mockImplementation(() => ({
        getAllProductos: mockGetAllProductos,
    })),
}))

vi.mock("../observability", () => ({
    createCorrelationId: vi.fn().mockReturnValue("corr_match_1"),
    logContificoEvent: mockLogContificoEvent,
}))

import { runProductMatch } from "./product-match"

function createResponse() {
    const json = vi.fn()
    const status = vi.fn().mockReturnValue({ json })
    return { json, status }
}

describe("product match use case", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockGetContificoConfig.mockResolvedValue({
            normalized: {
                api_key: "key_123",
                import_filters: { mode: "and", rules: [] },
                advanced_settings: {
                    matching: {
                        priority: ["sku", "barcode", "exact_name", "similar_name"],
                        exclude_if_multiple_candidates: false,
                        similarity_threshold: 0.5,
                    },
                },
            },
        })
    })

    it("computes exact SKU matches and excludes already linked Medusa products from available candidates", async () => {
        const productService = {
            listProducts: vi.fn().mockResolvedValue([
                {
                    id: "prod_match",
                    title: "Naranja Deshidratada",
                    variants: [{ sku: "SKU-123", barcode: null }],
                },
                {
                    id: "prod_linked",
                    title: "Producto ya vinculado",
                    variants: [{ sku: "SKU-LINKED", barcode: null }],
                },
            ]),
        }
        const contificoService = {
            listAndCountContificoEntityMaps: vi.fn().mockResolvedValue([
                [
                    {
                        medusa_id: "prod_linked",
                        contifico_id: "cp_linked",
                        metadata: {},
                    },
                ],
                1,
            ]),
        }
        mockGetContificoService.mockReturnValue(contificoService)
        mockGetAllProductos.mockResolvedValue([
            {
                id: "cp_match",
                nombre: "Naranja Deshidratada",
                codigo: "SKU-123",
                estado: "A",
                imagen: null,
            },
            {
                id: "cp_linked",
                nombre: "Producto ya vinculado",
                codigo: "SKU-LINKED",
                estado: "A",
                imagen: null,
            },
        ])

        const res = createResponse()
        await runProductMatch(
            {
                query: {},
                scope: {
                    resolve: vi.fn().mockReturnValue(productService),
                },
            } as never,
            res as never
        )

        expect(res.status).not.toHaveBeenCalled()
        expect(res.json).toHaveBeenCalledTimes(1)
        const payload = res.json.mock.calls[0][0]
        expect(payload.matches).toHaveLength(1)
        expect(payload.matches[0]).toMatchObject({
            contifico_id: "cp_match",
            medusa_id: "prod_match",
            match_type: "exact_sku",
            similarity: 1,
        })
        expect(payload.available_medusa).toEqual([
            {
                medusa_id: "prod_match",
                medusa_title: "Naranja Deshidratada",
                medusa_sku: "SKU-123",
            },
        ])
        expect(payload.stats).toMatchObject({
            exact_sku: 1,
            already_linked: 1,
            unmatched_contifico: 0,
        })
    })

    it("builds relink candidates from plugin-created mappings without depending on active Contifico matches", async () => {
        const productService = {
            listProducts: vi.fn().mockResolvedValue([
                {
                    id: "prod_current",
                    title: "Mandarina antigua",
                    variants: [{ sku: "OLD-1", barcode: null }],
                },
                {
                    id: "prod_linked_elsewhere",
                    title: "Mandarina Deshidratada",
                    variants: [{ sku: "LINKED-1", barcode: null }],
                },
                {
                    id: "prod_suggested",
                    title: "Mandarina Deshidratada",
                    variants: [{ sku: "NEW-1", barcode: null }],
                },
            ]),
        }
        const contificoService = {
            listAndCountContificoEntityMaps: vi.fn().mockResolvedValue([
                [
                    {
                        medusa_id: "prod_current",
                        contifico_id: "cp_relink",
                        metadata: {
                            created: true,
                            nombre: "Mandarina Deshidratada",
                            codigo: "MDR001",
                        },
                    },
                    {
                        medusa_id: "prod_linked_elsewhere",
                        contifico_id: "cp_existing",
                        metadata: {},
                    },
                ],
                2,
            ]),
        }
        mockGetContificoService.mockReturnValue(contificoService)
        mockGetAllProductos.mockResolvedValue([])

        const res = createResponse()
        await runProductMatch(
            {
                query: {},
                scope: {
                    resolve: vi.fn().mockReturnValue(productService),
                },
            } as never,
            res as never
        )

        const payload = res.json.mock.calls[0][0]
        expect(payload.matches).toEqual([])
        expect(payload.relink_candidates).toHaveLength(1)
        expect(payload.relink_candidates[0]).toMatchObject({
            contifico_id: "cp_relink",
            current_medusa_id: "prod_current",
            suggested_medusa_id: "prod_suggested",
        })
        expect(payload.available_medusa).toEqual([
            {
                medusa_id: "prod_suggested",
                medusa_title: "Mandarina Deshidratada",
                medusa_sku: "NEW-1",
            },
        ])
    })
})
