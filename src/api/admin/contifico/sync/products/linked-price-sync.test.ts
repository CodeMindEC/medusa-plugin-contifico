import { beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeAdvancedSettings } from "../../../../../lib/advanced-settings"
import { syncLinkedProductPrices } from "./linked-price-sync"

describe("linked price sync", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("syncs the price of a single-variant linked product and captures its previous snapshot", async () => {
        const updateContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const updatePriceSets = vi.fn().mockResolvedValue(undefined)
        const context = {
            stream: { progress: vi.fn() },
            services: {
                query: {
                    graph: vi.fn().mockResolvedValue({
                        data: [
                            {
                                id: "var_1",
                                price_set: {
                                    id: "pset_1",
                                    prices: [
                                        {
                                            amount: 9.99,
                                            currency_code: "usd",
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                },
                pricingService: {
                    updatePriceSets,
                },
                contificoService: {
                    updateContificoEntityMaps,
                },
            },
            config: {
                variant_mode: "auto",
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                    },
                }),
            },
        }
        const medusaCatalog = {
            medusaById: new Map([
                [
                    "prod_1",
                    {
                        id: "prod_1",
                        title: "Producto simple",
                        variants: [
                            {
                                id: "var_1",
                                title: "Default",
                                sku: "SKU-1",
                                metadata: {},
                            },
                        ],
                    },
                ],
            ]),
            mapByContifico: new Map([
                [
                    "cp_1",
                    {
                        id: "map_1",
                        medusa_id: "prod_1",
                        contifico_id: "cp_1",
                        metadata: {},
                    },
                ],
            ]),
            mapByMedusa: new Map([
                [
                    "prod_1",
                    {
                        id: "map_1",
                        medusa_id: "prod_1",
                        contifico_id: "cp_1",
                        metadata: {},
                    },
                ],
            ]),
        }
        const metrics = {
            totalErrors: 0,
            totalLinkedPriceUpdated: 0,
            totalWeightedDeferred: 0,
            totalWeightedPriceUpdated: 0,
        }

        const warnings = await syncLinkedProductPrices(
            context as never,
            medusaCatalog as never,
            [
                {
                    medusaId: "prod_1",
                    cp: {
                        id: "cp_1",
                        codigo: "CP-1",
                        nombre: "Producto simple",
                        pvp1: "12.34",
                        cantidad_stock: "5",
                    },
                    mappingMetadata: {},
                },
            ] as never,
            metrics as never,
            []
        )

        expect(warnings).toEqual([])
        expect(updatePriceSets).toHaveBeenCalledWith("pset_1", {
            prices: [
                {
                    amount: 12.34,
                    currency_code: "usd",
                    min_quantity: undefined,
                    max_quantity: undefined,
                    rules: undefined,
                },
            ],
        })
        expect(metrics.totalLinkedPriceUpdated).toBe(1)
        expect(updateContificoEntityMaps).toHaveBeenCalledWith({
            id: "map_1",
            metadata: expect.objectContaining({
                contifico_stock_grams: 5,
                sync_snapshot: expect.objectContaining({
                    variant_price_sets: [
                        expect.objectContaining({
                            variant_id: "var_1",
                            price_set_id: "pset_1",
                        }),
                    ],
                }),
            }),
        })
    })

    it("warns instead of overwriting prices when a multi-variant linked product has no safe PVP mapping", async () => {
        const updateContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const updatePriceSets = vi.fn().mockResolvedValue(undefined)
        const context = {
            stream: { progress: vi.fn() },
            services: {
                query: {
                    graph: vi.fn().mockResolvedValue({
                        data: [
                            {
                                id: "var_1",
                                price_set: {
                                    id: "pset_1",
                                    prices: [{ amount: 1, currency_code: "usd" }],
                                },
                            },
                            {
                                id: "var_2",
                                price_set: {
                                    id: "pset_2",
                                    prices: [{ amount: 2, currency_code: "usd" }],
                                },
                            },
                        ],
                    }),
                },
                pricingService: {
                    updatePriceSets,
                },
                contificoService: {
                    updateContificoEntityMaps,
                },
            },
            config: {
                variant_mode: "auto",
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                    },
                }),
            },
        }
        const medusaCatalog = {
            medusaById: new Map([
                [
                    "prod_2",
                    {
                        id: "prod_2",
                        title: "Producto ambiguo",
                        variants: [
                            {
                                id: "var_1",
                                title: "Rojo",
                                sku: "CUSTOM-A",
                                metadata: {},
                            },
                            {
                                id: "var_2",
                                title: "Azul",
                                sku: "CUSTOM-B",
                                metadata: {},
                            },
                        ],
                    },
                ],
            ]),
            mapByContifico: new Map([
                [
                    "cp_2",
                    {
                        id: "map_2",
                        medusa_id: "prod_2",
                        contifico_id: "cp_2",
                        metadata: {},
                    },
                ],
            ]),
            mapByMedusa: new Map([
                [
                    "prod_2",
                    {
                        id: "map_2",
                        medusa_id: "prod_2",
                        contifico_id: "cp_2",
                        metadata: {},
                    },
                ],
            ]),
        }
        const metrics = {
            totalErrors: 0,
            totalLinkedPriceUpdated: 0,
            totalWeightedDeferred: 0,
            totalWeightedPriceUpdated: 0,
        }

        const warnings = await syncLinkedProductPrices(
            context as never,
            medusaCatalog as never,
            [
                {
                    medusaId: "prod_2",
                    cp: {
                        id: "cp_2",
                        codigo: "CP-2",
                        nombre: "Producto ambiguo",
                        pvp1: "10",
                        pvp2: "20",
                        cantidad_stock: "8",
                    },
                    mappingMetadata: {},
                },
            ] as never,
            metrics as never,
            []
        )

        expect(updatePriceSets).not.toHaveBeenCalled()
        expect(metrics.totalLinkedPriceUpdated).toBe(0)
        expect(warnings).toEqual([
            expect.objectContaining({
                contifico_id: "cp_2",
                medusa_id: "prod_2",
                message: expect.stringContaining(
                    "no hay una correspondencia segura de PVP"
                ),
            }),
        ])
        expect(updateContificoEntityMaps).not.toHaveBeenCalled()
    })
})
