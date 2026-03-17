import { describe, expect, it } from "vitest"
import {
    getWeightedFallbackPvpField,
    normalizeAdvancedSettings,
    normalizeProductRulesOverride,
    resolveEffectiveProductRules,
} from "./advanced-settings"

describe("advanced settings v2", () => {
    it("migrates legacy weighted rules into the v2 strategy contract", () => {
        const normalized = normalizeAdvancedSettings(
            {
                version: 1 as never,
                weighted: {
                    enabled: true,
                    pvp_field_by_grams: [
                        { grams: 500, field: "pvp3" },
                        { grams: 100, field: "pvp1" },
                        { grams: 250, field: "pvp2" },
                    ],
                },
            },
            {
                default_weighted_pvp_field: "pvp4",
                default_weighted_enabled: true,
            }
        )

        expect(normalized.version).toBe(2)
        expect(normalized.migration_status).toBe("migrated_v2")
        expect(normalized.weighted.pricing_strategy).toBe("rules_by_weight")
        expect(normalized.weighted.strategy_config).toEqual({
            fallback_field: "pvp4",
            rules: [
                { grams: 100, field: "pvp1" },
                { grams: 250, field: "pvp2" },
                { grams: 500, field: "pvp3" },
            ],
        })
    })

    it("merges per-product overrides without losing the weighted strategy", () => {
        const base = normalizeAdvancedSettings({
            version: 2,
            weighted: {
                enabled: true,
                pricing_strategy: "rules_by_weight",
                strategy_config: {
                    fallback_field: "pvp1",
                    rules: [{ grams: 250, field: "pvp2" }],
                },
            },
        })

        const effective = resolveEffectiveProductRules(base, {
            pricing: {
                default_pvp_field: "pvp4",
            },
            weighted: {
                allow_weighted_price_sync: false,
                strategy_config: {
                    fallback_field: "pvp4",
                },
            },
        })

        expect(effective.weighted.pricing_strategy).toBe("rules_by_weight")
        expect(getWeightedFallbackPvpField(effective.weighted)).toBe("pvp4")
        expect(effective.weighted.allow_weighted_price_sync).toBe(false)
        expect(effective.weighted.strategy_config).toEqual({
            fallback_field: "pvp4",
            rules: [{ grams: 250, field: "pvp2" }],
        })
    })

    it("normalizes product rule overrides to v2 weighted shape", () => {
        const normalized = normalizeProductRulesOverride({
            weighted: {
                pricing_strategy: "rules_by_weight",
                pvp_field_by_grams: [
                    { grams: 100, field: "pvp1" },
                    { grams: 100, field: "pvp2" },
                ],
            },
        })

        expect(normalized?.weighted).toEqual({
            pricing_strategy: "rules_by_weight",
            strategy_config: {
                fallback_field: "pvp1",
                rules: [{ grams: 100, field: "pvp2" }],
            },
        })
    })
})
