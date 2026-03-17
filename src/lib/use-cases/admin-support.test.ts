import { beforeEach, describe, expect, it, vi } from "vitest"

const {
    mockGetContificoConfig,
    mockGetAllBodegas,
    mockTestConnection,
    mockGetAllProductos,
    mockLogContificoEvent,
} = vi.hoisted(() => ({
    mockGetContificoConfig: vi.fn(),
    mockGetAllBodegas: vi.fn(),
    mockTestConnection: vi.fn(),
    mockGetAllProductos: vi.fn(),
    mockLogContificoEvent: vi.fn(),
}))

vi.mock("../../api/admin/contifico/shared", () => ({
    getContificoConfig: mockGetContificoConfig,
}))

vi.mock("../client", () => ({
    ContificoClient: vi.fn().mockImplementation(() => ({
        getAllBodegas: mockGetAllBodegas,
        testConnection: mockTestConnection,
        getAllProductos: mockGetAllProductos,
    })),
}))

vi.mock("../observability", () => ({
    createCorrelationId: vi
        .fn()
        .mockReturnValueOnce("corr_bodegas")
        .mockReturnValueOnce("corr_connection")
        .mockReturnValueOnce("corr_migrate"),
    getErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
    logContificoEvent: mockLogContificoEvent,
}))

import {
    checkContificoConnection,
    listConfiguredBodegas,
    migrateLinkedProductMetadata,
} from "./admin-support"

describe("admin support use cases", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("lists bodegas using the normalized configured api key", async () => {
        mockGetContificoConfig.mockResolvedValue({
            normalized: {
                api_key: "key_configured",
            },
        })
        mockGetAllBodegas.mockResolvedValue([{ id: "bod_1", nombre: "Principal" }])

        const result = await listConfiguredBodegas({
            listAndCountContificoConfigs: vi.fn(),
        } as never)

        expect(result).toEqual({
            bodegas: [{ id: "bod_1", nombre: "Principal" }],
            correlation_id: "corr_bodegas",
        })
    })

    it("checks connection with an explicit API key override when provided", async () => {
        mockTestConnection.mockResolvedValue({ bodegas: 3 })

        const result = await checkContificoConnection({
            service: {} as never,
            apiKey: "key_override",
        })

        expect(mockGetContificoConfig).not.toHaveBeenCalled()
        expect(result).toEqual({
            ok: true,
            message: "Conexion exitosa. 3 bodega(s) encontrada(s).",
            bodegas: 3,
            correlation_id: "corr_connection",
        })
    })

    it("migrates linked product metadata only when the remote name or image changed", async () => {
        mockGetContificoConfig.mockResolvedValue({
            normalized: {
                api_key: "key_configured",
            },
        })
        mockGetAllProductos.mockResolvedValue([
            {
                id: "cp_1",
                nombre: "Producto actualizado",
                imagen: "https://img.test/1.png",
                codigo: "SKU-1",
            },
            {
                id: "cp_2",
                nombre: "Sin cambios",
                imagen: null,
                codigo: "SKU-2",
            },
        ])
        const updateContificoEntityMaps = vi.fn().mockResolvedValue(undefined)

        const result = await migrateLinkedProductMetadata({
            listAndCountContificoEntityMaps: vi.fn().mockResolvedValue([
                [
                    {
                        id: "map_1",
                        contifico_id: "cp_1",
                        metadata: {
                            nombre: "Producto viejo",
                            imagen: null,
                        },
                    },
                    {
                        id: "map_2",
                        contifico_id: "cp_2",
                        metadata: {
                            nombre: "Sin cambios",
                            imagen: null,
                        },
                    },
                    {
                        id: "map_3",
                        contifico_id: "cp_missing",
                        metadata: {},
                    },
                ],
                3,
            ]),
            updateContificoEntityMaps,
        } as never)

        expect(updateContificoEntityMaps).toHaveBeenCalledTimes(1)
        expect(updateContificoEntityMaps).toHaveBeenCalledWith({
            id: "map_1",
            metadata: expect.objectContaining({
                nombre: "Producto actualizado",
                imagen: "https://img.test/1.png",
                codigo: "SKU-1",
                schema_version: 2,
            }),
        })
        expect(result).toEqual({
            success: true,
            updated: 1,
            skipped: 2,
            total: 3,
            errors: [],
            correlation_id: "corr_migrate",
        })
    })
})
