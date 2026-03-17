import { describe, expect, it, vi } from "vitest"
import {
    deleteInventoryItemsAfterProductCleanup,
    deleteProductsAndCollectMapIds,
    unlinkExistingProducts,
} from "./delete-imported-products"

describe("delete imported products use case", () => {
    it("only returns map ids for products that were actually deleted", async () => {
        const deleteProducts = vi
            .fn()
            .mockRejectedValueOnce(new Error("batch fail"))
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("still failing"))
        const result = await deleteProductsAndCollectMapIds(
            {
                deleteProducts,
            } as never,
            [
                { product_id: "prod_1", map_id: "map_1" },
                { product_id: "prod_2", map_id: "map_2" },
            ]
        )

        expect(result.deleted).toBe(1)
        expect(result.deletedProductIds).toEqual(["prod_1"])
        expect(result.deletedMapIds).toEqual(["map_1"])
        expect(result.errors).toEqual([
            {
                producto: "prod_2",
                error: "still failing",
            },
        ])
    })

    it("restores price snapshots before unlinking existing Medusa products", async () => {
        const updatePriceSets = vi.fn().mockResolvedValue(undefined)

        const result = await unlinkExistingProducts(
            {
                updatePriceSets,
            } as never,
            [
                {
                    map_id: "map_1",
                    medusa_id: "prod_existing",
                    metadata: {
                        sync_snapshot: {
                            captured_at: "2026-03-14T00:00:00.000Z",
                            variant_price_sets: [
                                {
                                    variant_id: "var_1",
                                    price_set_id: "pset_1",
                                    prices: [
                                        {
                                            amount: 5.55,
                                            currency_code: "usd",
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                    action: "unlink_only",
                    restore_prices: true,
                },
                {
                    map_id: "map_2",
                    medusa_id: "prod_without_snapshot",
                    metadata: {},
                    action: "unlink_only",
                    restore_prices: false,
                },
            ] as never
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
        expect(result).toEqual({
            unlinked: 2,
            restored_prices: 1,
            missing_snapshot: 1,
            errors: [],
            deletedMapIds: ["map_1", "map_2"],
            failedEntries: [],
        })
    })

    it("deletes inventory items after product cleanup with batch fallback", async () => {
        const deleteInventoryItems = vi
            .fn()
            .mockRejectedValueOnce(new Error("batch fail"))
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("still linked"))

        const result = await deleteInventoryItemsAfterProductCleanup(
            {
                deleteInventoryItems,
            } as never,
            ["inv_1", "inv_2"]
        )

        expect(deleteInventoryItems).toHaveBeenNthCalledWith(1, ["inv_1", "inv_2"])
        expect(deleteInventoryItems).toHaveBeenNthCalledWith(2, ["inv_1"])
        expect(deleteInventoryItems).toHaveBeenNthCalledWith(3, ["inv_2"])
        expect(result).toEqual([
            {
                producto: "inv_2",
                error: "still linked",
            },
        ])
    })
})
