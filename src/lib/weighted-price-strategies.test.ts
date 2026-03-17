import { describe, expect, it } from "vitest"
import {
    explainWeightedPriceStrategy,
    normalizeWeightedPriceStrategyConfig,
    resolveWeightedPriceStrategyField,
} from "./weighted-price-strategies"

describe("weighted price strategies", () => {
    it("resolves fixed_pvp_field deterministically", () => {
        const config = normalizeWeightedPriceStrategyConfig(
            "fixed_pvp_field",
            { field: "pvp3" },
            { fallback_field: "pvp1" }
        )

        expect(
            resolveWeightedPriceStrategyField("fixed_pvp_field", config, {
                grams: 250,
                fallback_field: "pvp1",
            })
        ).toBe("pvp3")
    })

    it("matches exact grams and falls back cleanly in rules_by_weight", () => {
        const config = normalizeWeightedPriceStrategyConfig(
            "rules_by_weight",
            {
                fallback_field: "pvp4",
                rules: [
                    { grams: 500, field: "pvp3" },
                    { grams: 100, field: "pvp1" },
                ],
            },
            { fallback_field: "pvp2" }
        )

        expect(
            resolveWeightedPriceStrategyField("rules_by_weight", config, {
                grams: 100,
                fallback_field: "pvp2",
            })
        ).toBe("pvp1")
        expect(
            resolveWeightedPriceStrategyField("rules_by_weight", config, {
                grams: 250,
                fallback_field: "pvp2",
            })
        ).toBe("pvp4")
        expect(explainWeightedPriceStrategy("rules_by_weight", config)).toEqual({
            fallback_field: "pvp4",
            rules: [
                { grams: 100, field: "pvp1" },
                { grams: 500, field: "pvp3" },
            ],
            summary: "2 regla(s) por peso + fallback PVP4",
        })
    })
})
