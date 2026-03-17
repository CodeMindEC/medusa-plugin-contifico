import { beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeAdvancedSettings } from "../../../../../lib/advanced-settings"

import { syncWeightedLinkedProductPrices } from "./weighted-sync"

describe("weighted sync", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("skips variant price updates when the current Medusa price already matches the weighted target", async () => {
        const updateContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const updatePriceSets = vi.fn().mockResolvedValue(undefined)
        const context = {
            req: { scope: {} },
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
                                            amount: 5.55,
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
                weighted_pvp_field: "pvp1",
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                        pricing_strategy: "fixed_pvp_field",
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
                        title: "Producto weighted",
                        variants: [
                            {
                                id: "var_1",
                                title: "100g",
                                sku: "SKU-1",
                                weight: 100,
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
            totalWeightedDeferred: 0,
            totalWeightedPriceUpdated: 0,
        }
        const warnings = await syncWeightedLinkedProductPrices(
            context as never,
            medusaCatalog as never,
            [
                {
                    medusaId: "prod_1",
                    cp: {
                        id: "cp_1",
                        nombre: "Producto weighted",
                        pvp1: "0.0555",
                        cantidad_stock: "10",
                    },
                    mappingMetadata: {
                        mapping_mode_override: "weighted",
                    },
                },
            ] as never,
            metrics as never,
            []
        )

        expect(updatePriceSets).not.toHaveBeenCalled()
        expect(metrics.totalWeightedPriceUpdated).toBe(0)
        expect(warnings).toEqual([])
        expect(updateContificoEntityMaps).toHaveBeenCalledWith({
            id: "map_1",
            metadata: expect.objectContaining({
                contifico_stock_grams: 10,
            }),
        })
    })

    it("captures a price snapshot before overwriting an existing Medusa price", async () => {
        const updateContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const updatePriceSets = vi.fn().mockResolvedValue(undefined)
        const context = {
            req: { scope: {} },
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
                weighted_pvp_field: "pvp1",
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                        pricing_strategy: "fixed_pvp_field",
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
                        title: "Producto weighted",
                        variants: [
                            {
                                id: "var_1",
                                title: "100g",
                                sku: "SKU-1",
                                weight: 100,
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
            totalWeightedDeferred: 0,
            totalWeightedPriceUpdated: 0,
        }

        await syncWeightedLinkedProductPrices(
            context as never,
            medusaCatalog as never,
            [
                {
                    medusaId: "prod_1",
                    cp: {
                        id: "cp_1",
                        nombre: "Producto weighted",
                        pvp1: "0.0555",
                        cantidad_stock: "10",
                    },
                    mappingMetadata: {
                        mapping_mode_override: "weighted",
                    },
                },
            ] as never,
            metrics as never,
            []
        )

        expect(updatePriceSets).toHaveBeenCalledWith("pset_1", {
            prices: [
                {
                    amount: 5.55,
                    currency_code: "usd",
                    min_quantity: undefined,
                    max_quantity: undefined,
                    rules: undefined,
                },
            ],
        })
        expect(metrics.totalWeightedPriceUpdated).toBe(1)
        expect(updateContificoEntityMaps).toHaveBeenCalledWith({
            id: "map_1",
            metadata: expect.objectContaining({
                contifico_stock_grams: 10,
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

    it("creates and links a price set when a weighted variant has no linked price set yet", async () => {
        const updateContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const updatePriceSets = vi.fn().mockResolvedValue(undefined)
        const createPriceSets = vi.fn().mockResolvedValue({ id: "pset_created" })
        const linkCreate = vi.fn().mockResolvedValue(undefined)
        const context = {
            req: { scope: {} },
            stream: { progress: vi.fn() },
            services: {
                query: {
                    graph: vi.fn().mockResolvedValue({
                        data: [
                            {
                                id: "var_1",
                                price_set: {
                                    id: null,
                                    prices: [],
                                },
                            },
                        ],
                    }),
                },
                pricingService: {
                    updatePriceSets,
                    createPriceSets,
                },
                link: {
                    create: linkCreate,
                },
                contificoService: {
                    updateContificoEntityMaps,
                },
            },
            config: {
                weighted_pvp_field: "pvp1",
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                        pricing_strategy: "fixed_pvp_field",
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
                        title: "Producto weighted",
                        variants: [
                            {
                                id: "var_1",
                                title: "100g",
                                sku: "SKU-1",
                                weight: 100,
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
            totalWeightedDeferred: 0,
            totalWeightedPriceUpdated: 0,
        }
        const errors: Array<{ producto: string; error: string }> = []

        await expect(
            syncWeightedLinkedProductPrices(
                context as never,
                medusaCatalog as never,
                [
                    {
                        medusaId: "prod_1",
                        cp: {
                            id: "cp_1",
                            nombre: "Producto weighted",
                            pvp1: "0.0555",
                            cantidad_stock: "10",
                        },
                        mappingMetadata: {
                            mapping_mode_override: "weighted",
                        },
                    },
                ] as never,
                metrics as never,
                errors as never
            )
        ).resolves.toEqual([])

        expect(createPriceSets).toHaveBeenCalledWith({
            prices: [
                {
                    amount: 5.55,
                    currency_code: "usd",
                    min_quantity: undefined,
                    max_quantity: undefined,
                    rules: undefined,
                },
            ],
        })
        expect(linkCreate).toHaveBeenCalledWith({
            product: { variant_id: "var_1" },
            pricing: { price_set_id: "pset_created" },
        })
        expect(updatePriceSets).not.toHaveBeenCalled()
        expect(metrics.totalErrors).toBe(0)
        expect(metrics.totalWeightedPriceUpdated).toBe(1)
        expect(errors).toEqual([])
    })

    it("records a weighted sync error instead of crashing the whole run", async () => {
        const updateContificoEntityMaps = vi
            .fn()
            .mockRejectedValue(new Error("map update failed"))
        const updatePriceSets = vi.fn().mockResolvedValue(undefined)
        const listAndCountContificoEntityMaps = vi.fn().mockResolvedValue([
            [
                {
                    id: "map_1",
                    medusa_id: "prod_1",
                    contifico_id: "cp_1",
                    metadata: {},
                },
            ],
            1,
        ])
        const context = {
            req: { scope: {} },
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
                                            amount: 5.55,
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
                    listAndCountContificoEntityMaps,
                },
            },
            config: {
                weighted_pvp_field: "pvp1",
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                        pricing_strategy: "fixed_pvp_field",
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
                        title: "Producto weighted",
                        variants: [
                            {
                                id: "var_1",
                                title: "100g",
                                sku: "SKU-1",
                                weight: 100,
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
            totalWeightedDeferred: 0,
            totalWeightedPriceUpdated: 0,
        }
        const errors: Array<{ producto: string; error: string }> = []

        await expect(
            syncWeightedLinkedProductPrices(
                context as never,
                medusaCatalog as never,
                [
                    {
                        medusaId: "prod_1",
                        cp: {
                            id: "cp_1",
                            nombre: "Producto weighted",
                            pvp1: "0.0555",
                            cantidad_stock: "10",
                        },
                        mappingMetadata: {
                            mapping_mode_override: "weighted",
                        },
                    },
                ] as never,
                metrics as never,
                errors as never
            )
        ).resolves.toEqual([])

        expect(metrics.totalErrors).toBe(1)
        expect(errors).toEqual([
            {
                producto: "Producto weighted",
                error: "map update failed",
            },
        ])
    })

    it("refreshes a stale cached map id before persisting weighted metadata", async () => {
        const updateContificoEntityMaps = vi
            .fn()
            .mockRejectedValueOnce(
                new Error(
                    'ContificoEntityMap with id "prod_1 - cp_1" not found'
                )
            )
            .mockResolvedValue(undefined)
        const updatePriceSets = vi.fn().mockResolvedValue(undefined)
        const listAndCountContificoEntityMaps = vi.fn().mockResolvedValue([
            [
                {
                    id: "map_real",
                    medusa_id: "prod_1",
                    contifico_id: "cp_1",
                    metadata: {},
                },
            ],
            1,
        ])
        const context = {
            req: { scope: {} },
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
                                            amount: 5.55,
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
                    listAndCountContificoEntityMaps,
                },
            },
            config: {
                weighted_pvp_field: "pvp1",
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                        pricing_strategy: "fixed_pvp_field",
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
                        title: "Producto weighted",
                        variants: [
                            {
                                id: "var_1",
                                title: "100g",
                                sku: "SKU-1",
                                weight: 100,
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
                        id: "prod_1 - cp_1",
                        medusa_id: "prod_1",
                        contifico_id: "cp_1",
                        metadata: {},
                    },
                ],
            ]),
            mapByMedusa: new Map(),
        }
        const metrics = {
            totalErrors: 0,
            totalWeightedDeferred: 0,
            totalWeightedPriceUpdated: 0,
        }
        const errors: Array<{ producto: string; error: string }> = []

        await expect(
            syncWeightedLinkedProductPrices(
                context as never,
                medusaCatalog as never,
                [
                    {
                        medusaId: "prod_1",
                        cp: {
                            id: "cp_1",
                            nombre: "Producto weighted",
                            pvp1: "0.0555",
                            cantidad_stock: "10",
                        },
                        mappingMetadata: {
                            mapping_mode_override: "weighted",
                        },
                    },
                ] as never,
                metrics as never,
                errors as never
            )
        ).resolves.toEqual([])

        expect(metrics.totalErrors).toBe(0)
        expect(errors).toEqual([])
        expect(listAndCountContificoEntityMaps).toHaveBeenCalledWith({
            entity_type: "product",
            medusa_id: "prod_1",
            contifico_id: "cp_1",
        })
        expect(updateContificoEntityMaps).toHaveBeenNthCalledWith(1, {
            id: "prod_1 - cp_1",
            metadata: expect.any(Object),
        })
        expect(updateContificoEntityMaps).toHaveBeenNthCalledWith(2, {
            id: "map_real",
            metadata: expect.any(Object),
        })
    })
})
