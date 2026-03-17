import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
    createProductLinks,
    runRelinkProductLink,
    updateProductLink,
} from "./product-links"
import { normalizeAdvancedSettings } from "../advanced-settings"
import { resetContificoLogger, setContificoLogger } from "../observability"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CONTIFICO_MODULE } from "../../modules/contifico"
import { ContificoClient } from "../client"
import * as shared from "../../api/admin/contifico/shared"

describe("product links use cases", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        setContificoLogger({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        })
    })

    it("creates only valid links and skips duplicates on either side", async () => {
        const createContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const service = {
            listAndCountContificoEntityMaps: vi.fn().mockImplementation((filters) => {
                if (filters.medusa_id === "prod_existing") {
                    return Promise.resolve([[{ id: "map_taken" }], 1])
                }
                if (filters.contifico_id === "cp_existing") {
                    return Promise.resolve([[{ id: "map_taken" }], 1])
                }
                return Promise.resolve([[], 0])
            }),
            createContificoEntityMaps,
        }

        const result = await createProductLinks(
            service as never,
            [
                {
                    contifico_id: "cp_ok",
                    medusa_id: "prod_ok",
                    contifico_codigo: "SKU-1",
                    contifico_nombre: "Producto 1",
                    mapping_mode_override: "weighted",
                    weighted_pvp_field: "pvp3",
                    product_rules_override: {
                        pricing: { markup_percent: 12 },
                    },
                    weighted_price_sync_override: true,
                },
                {
                    contifico_id: "cp_2",
                    medusa_id: "prod_existing",
                },
                {
                    contifico_id: "cp_existing",
                    medusa_id: "prod_3",
                },
            ],
            "corr_links_1"
        )

        expect(createContificoEntityMaps).toHaveBeenCalledTimes(1)
        expect(createContificoEntityMaps).toHaveBeenCalledWith({
            entity_type: "product",
            medusa_id: "prod_ok",
            contifico_id: "cp_ok",
            metadata: expect.objectContaining({
                codigo: "SKU-1",
                nombre: "Producto 1",
                link_origin: "manual",
                mapping_mode_override: "weighted",
                weighted_pvp_field: "pvp3",
                product_rules_override: {
                    pricing: { markup_percent: 12 },
                    weighted: { allow_weighted_price_sync: true },
                },
                schema_version: 2,
            }),
        })
        expect(result).toEqual({
            linked: 1,
            skipped: 2,
            correlation_id: "corr_links_1",
            details: {
                created: [{ medusa_id: "prod_ok", contifico_id: "cp_ok" }],
                skipped: [
                    {
                        medusa_id: "prod_existing",
                        contifico_id: "cp_2",
                        reason: "Ya existe un mapeo para este producto de Medusa",
                    },
                    {
                        medusa_id: "prod_3",
                        contifico_id: "cp_existing",
                        reason: "Ya existe un mapeo para este producto de Contifico",
                    },
                ],
            },
        })
    })

    it("relinks a product and preserves override metadata while clearing plugin-created flags", async () => {
        const deleteContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const createContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const deleteProducts = vi.fn().mockResolvedValue(undefined)
        const listProducts = vi.fn().mockResolvedValue([
            {
                id: "prod_old",
                variants: [{ id: "variant_old_100" }, { id: "variant_old_250" }],
            },
        ])
        const listInventoryLevels = vi.fn().mockResolvedValue([
            { id: "level_1" },
            { id: "level_2" },
        ])
        const deleteInventoryLevels = vi.fn().mockResolvedValue(undefined)
        const deleteInventoryItems = vi.fn().mockResolvedValue(undefined)
        const query = {
            graph: vi.fn().mockResolvedValue({
                data: [
                    {
                        variant_id: "variant_old_100",
                        inventory_item_id: "inventory_1",
                    },
                    {
                        variant_id: "variant_old_250",
                        inventory_item_id: "inventory_2",
                    },
                ],
            }),
        }
        const service = {
            listAndCountContificoEntityMaps: vi
                .fn()
                .mockResolvedValueOnce([
                    [
                        {
                            id: "map_1",
                            medusa_id: "prod_old",
                            contifico_id: "cp_ok",
                            metadata: {
                                created: true,
                                auto_linked: true,
                                nombre: "Producto A",
                                sync_state: {
                                    catalog_fingerprint: "old_catalog",
                                    weighted_config_fingerprint: "old_weighted",
                                    last_catalog_sync_at: "2026-03-15T00:00:00.000Z",
                                },
                                product_rules_override: {
                                    weighted: { allow_weighted_price_sync: true },
                                },
                            },
                        },
                    ],
                    1,
                ])
                .mockResolvedValueOnce([[], 0]),
            deleteContificoEntityMaps,
            createContificoEntityMaps,
        }

        const result = await updateProductLink(
            service as never,
            {
                contifico_id: "cp_ok",
                new_medusa_id: "prod_new",
                weighted_price_sync_override: false,
            },
            "corr_links_2",
            undefined,
            {
                productService: { deleteProducts, listProducts },
                inventoryService: {
                    listInventoryLevels,
                    deleteInventoryLevels,
                    deleteInventoryItems,
                },
                query,
            }
        )

        expect(deleteContificoEntityMaps).toHaveBeenCalledWith("map_1")
        expect(createContificoEntityMaps).toHaveBeenCalledWith({
            entity_type: "product",
            medusa_id: "prod_new",
            contifico_id: "cp_ok",
            metadata: expect.objectContaining({
                nombre: "Producto A",
                re_linked: true,
                re_linked_from: "prod_old",
                link_origin: "relinked_to_existing",
                product_rules_override: {
                    weighted: { allow_weighted_price_sync: false },
                },
            }),
        })
        expect(
            createContificoEntityMaps.mock.calls[0]?.[0]?.metadata
        ).not.toHaveProperty("sync_state")
        expect(deleteInventoryLevels).toHaveBeenCalledWith(["level_1", "level_2"])
        expect(deleteProducts).toHaveBeenCalledWith(["prod_old"])
        expect(deleteInventoryItems).toHaveBeenCalledWith(["inventory_1", "inventory_2"])
        expect(result).toEqual({
            status: "relinked",
            payload: {
                old_medusa_id: "prod_old",
                new_medusa_id: "prod_new",
            },
        })
    })

    it("does not fail relink when deleting the old plugin-created product cleanup fails", async () => {
        const deleteContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const createContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const deleteProducts = vi.fn().mockRejectedValue(new Error("already deleted"))
        const listProducts = vi.fn().mockResolvedValue([
            {
                id: "prod_old",
                variants: [{ id: "variant_old_100" }],
            },
        ])
        const service = {
            listAndCountContificoEntityMaps: vi
                .fn()
                .mockResolvedValueOnce([
                    [
                        {
                            id: "map_2",
                            medusa_id: "prod_old",
                            contifico_id: "cp_warn",
                            metadata: {
                                created: true,
                                nombre: "Producto duplicado",
                            },
                        },
                    ],
                    1,
                ])
                .mockResolvedValueOnce([[], 0]),
            deleteContificoEntityMaps,
            createContificoEntityMaps,
        }

        const result = await updateProductLink(
            service as never,
            {
                contifico_id: "cp_warn",
                new_medusa_id: "prod_existing",
            },
            "corr_links_3",
            undefined,
            {
                productService: { deleteProducts, listProducts },
            }
        )

        expect(deleteProducts).toHaveBeenCalledWith(["prod_old"])
        expect(result).toEqual({
            status: "relinked",
            payload: {
                old_medusa_id: "prod_old",
                new_medusa_id: "prod_existing",
            },
        })
    })

    it("refreshes weighted prices immediately after relinking a product", async () => {
        const deleteContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const createContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const listAndCountContificoEntityMaps = vi
            .fn()
            .mockResolvedValueOnce([
                [
                    {
                        id: "map_old",
                        medusa_id: "prod_old",
                        contifico_id: "cp_ok",
                        metadata: {
                            nombre: "Producto A",
                            sync_state: {
                                catalog_fingerprint: "old_catalog",
                                weighted_config_fingerprint: "old_weighted",
                                last_catalog_sync_at: "2026-03-15T00:00:00.000Z",
                            },
                            mapping_mode_override: "weighted",
                        },
                    },
                ],
                1,
            ])
            .mockResolvedValueOnce([[], 0])
            .mockResolvedValueOnce([
                [
                    {
                        id: "map_new",
                        medusa_id: "prod_new",
                        contifico_id: "cp_ok",
                        metadata: {
                            nombre: "Producto A",
                            mapping_mode_override: "weighted",
                        },
                    },
                ],
                1,
            ])
        const listProducts = vi.fn().mockResolvedValue([
            {
                id: "prod_new",
                title: "Producto relinkeado",
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
        ])
        const query = {
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
        }
        const updatePriceSets = vi.fn().mockResolvedValue(undefined)
        const service = {
            listAndCountContificoEntityMaps,
            deleteContificoEntityMaps,
            createContificoEntityMaps,
            updateContificoEntityMaps: vi.fn().mockResolvedValue(undefined),
        }
        const resolve = vi.fn((key: string) => {
            if (key === CONTIFICO_MODULE) {
                return service
            }
            if (key === Modules.PRODUCT) {
                return { listProducts }
            }
            if (key === Modules.INVENTORY) {
                return {}
            }
            if (key === Modules.PRICING) {
                return { updatePriceSets }
            }
            if (key === ContainerRegistrationKeys.LINK) {
                return { create: vi.fn() }
            }
            if (key === "query") {
                return query
            }

            throw new Error(`Unexpected resolve key: ${key}`)
        })
        const json = vi.fn()
        const status = vi.fn().mockReturnThis()

        vi.spyOn(shared, "getContificoConfig").mockResolvedValue({
            raw: {} as never,
            normalized: {
                api_key: "test-key",
                bodega_ids: [],
                manage_inventory: false,
                allow_backorder: false,
                variant_mode: "weighted",
                shipping_profile_id: null,
                sales_channel_id: null,
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                        pricing_strategy: "fixed_pvp_field",
                    },
                }),
            } as never,
        })
        vi.spyOn(ContificoClient.prototype, "getProducto").mockResolvedValue({
            id: "cp_ok",
            codigo: "SKU-CP",
            nombre: "Producto A",
            estado: "A",
            tipo: "PRO",
            tipo_producto: "SIM",
            pvp_manual: false,
            pvp1: "0.0555",
            cantidad_stock: "10",
        })

        await runRelinkProductLink(
            {
                scope: { resolve },
                body: {
                    contifico_id: "cp_ok",
                    new_medusa_id: "prod_new",
                },
            } as never,
            {
                json,
                status,
            } as never
        )

        expect(deleteContificoEntityMaps).toHaveBeenCalledWith("map_old")
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
        expect(json).toHaveBeenCalledWith(
            expect.objectContaining({
                ok: true,
                old_medusa_id: "prod_old",
                new_medusa_id: "prod_new",
                weighted_price_updated: 1,
            })
        )
        expect(json.mock.calls[0]?.[0]).not.toHaveProperty("warning")
    })
})

afterAll(() => {
    resetContificoLogger()
})
