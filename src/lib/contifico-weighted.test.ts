import { describe, expect, it } from "vitest"
import { resolveWeightedPvpField } from "./contifico-weighted"

describe("contifico weighted", () => {
    it("keeps a product-level weighted field as a hard override for fixed strategy", () => {
        const field = resolveWeightedPvpField(
            { weighted_pvp_field: "pvp1" },
            {
                pricing_strategy: "fixed_pvp_field",
                strategy_config: { field: "pvp3" },
            },
            500,
            {
                weighted_pvp_field: "pvp2",
            }
        )

        expect(field).toBe("pvp2")
    })

    it("uses gram rules and only applies the product-level weighted field as fallback in rules_by_weight", () => {
        const fieldWithExactRule = resolveWeightedPvpField(
            { weighted_pvp_field: "pvp1" },
            {
                pricing_strategy: "rules_by_weight",
                strategy_config: {
                    fallback_field: "pvp1",
                    rules: [
                        { grams: 100, field: "pvp1" },
                        { grams: 250, field: "pvp2" },
                        { grams: 500, field: "pvp3" },
                    ],
                },
            },
            500,
            {
                weighted_pvp_field: "pvp1",
            }
        )
        const fieldWithoutRule = resolveWeightedPvpField(
            { weighted_pvp_field: "pvp4" },
            {
                pricing_strategy: "rules_by_weight",
                strategy_config: {
                    fallback_field: "pvp4",
                    rules: [{ grams: 250, field: "pvp2" }],
                },
            },
            100,
            {
                weighted_pvp_field: "pvp1",
            }
        )

        expect(fieldWithExactRule).toBe("pvp3")
        expect(fieldWithoutRule).toBe("pvp1")
    })
})
