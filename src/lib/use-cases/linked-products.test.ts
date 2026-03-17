import { beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeAdvancedSettings } from "../advanced-settings"

const { mockGetContificoConfig } = vi.hoisted(() => ({
    mockGetContificoConfig: vi.fn(),
}))

vi.mock("../../api/admin/contifico/shared", () => ({
    getContificoConfig: mockGetContificoConfig,
}))

import { listLinkedProducts } from "./linked-products"

describe("linked products use case", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("lists linked products, migrates stale metadata and resolves effective weighted diagnostics", async () => {
        mockGetContificoConfig.mockResolvedValue({
            normalized: {
                variant_mode: "auto",
                weighted_pvp_field: "pvp2",
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                        pricing_strategy: "fixed_pvp_field",
                    },
                }),
            },
        })

        const updateContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const contificoService = {
            listAndCountContificoEntityMaps: vi.fn().mockResolvedValue([
                [
                    {
                        id: "map_1",
                        medusa_id: "prod_1",
                        contifico_id: "cp_1",
                        metadata: {
                            nombre: "Producto weighted",
                            codigo: "P-1",
                            mapping_mode_override: "weighted",
                            product_rules_override: {
                                weighted: { allow_weighted_price_sync: false },
                            },
                        },
                    },
                ],
                1,
            ]),
            updateContificoEntityMaps,
        }
        const productService = {
            listProducts: vi.fn().mockResolvedValue([
                {
                    id: "prod_1",
                    title: "Producto weighted",
                    variants: [
                        {
                            id: "var_1",
                            title: "250g",
                            sku: "SKU-250",
                            metadata: { contifico_weight_grams: 250 },
                        },
                        {
                            id: "var_2",
                            title: "sin peso",
                            sku: "SKU-MISS",
                            metadata: {},
                        },
                    ],
                },
            ]),
        }

        const result = await listLinkedProducts(
            contificoService as never,
            productService as never,
            "corr_linked_1"
        )

        expect(updateContificoEntityMaps).toHaveBeenCalledTimes(1)
        expect(result.defaults).toMatchObject({
            variant_mode: "auto",
            weighted_pvp_field: "pvp2",
            weighted_price_sync_enabled: true,
            weighted_strategy: "fixed_pvp_field",
        })
        expect(result.linked).toHaveLength(1)
        expect(result.linked[0]).toMatchObject({
            contifico_id: "cp_1",
            medusa_id: "prod_1",
            mapping_mode: "weighted",
            weighted_pvp_field: "pvp2",
            weighted_price_sync_enabled: false,
            weighted_variants_total: 2,
            weighted_variants_ready: 1,
            weighted_ready: false,
        })
        expect(result.linked[0].weighted_missing_variants).toEqual(["sin peso"])
        expect(result.all_medusa).toEqual([
            {
                medusa_id: "prod_1",
                medusa_title: "Producto weighted",
                medusa_sku: "SKU-250",
            },
        ])
    })

    it("marks dangling links as missing while keeping only real Medusa products in the selector list", async () => {
        mockGetContificoConfig.mockResolvedValue({
            normalized: {
                variant_mode: "auto",
                weighted_pvp_field: "pvp1",
                advanced_settings: normalizeAdvancedSettings({}),
            },
        })

        const contificoService = {
            listAndCountContificoEntityMaps: vi.fn().mockResolvedValue([
                [
                    {
                        id: "map_missing",
                        medusa_id: "prod_deleted",
                        contifico_id: "cp_missing",
                        metadata: {
                            nombre: "Producto colgante",
                            codigo: "P-X",
                            created: true,
                        },
                    },
                ],
                1,
            ]),
            updateContificoEntityMaps: vi.fn().mockResolvedValue(undefined),
        }
        const productService = {
            listProducts: vi.fn().mockResolvedValue([
                {
                    id: "prod_real",
                    title: "Producto real",
                    variants: [{ id: "var_real", sku: "REAL-1" }],
                },
            ]),
        }

        const result = await listLinkedProducts(
            contificoService as never,
            productService as never,
            "corr_linked_missing"
        )

        expect(result.linked[0]).toMatchObject({
            contifico_id: "cp_missing",
            medusa_id: "prod_deleted",
            medusa_title: "Sin vínculo",
            medusa_missing: true,
        })
        expect(result.all_medusa).toEqual([
            {
                medusa_id: "prod_real",
                medusa_title: "Producto real",
                medusa_sku: "REAL-1",
            },
        ])
    })
})
