import { safeJsonParse } from "./json"
import type { WeightedPvpField } from "./contifico-config"
import type {
    AdvancedContificoSettings,
    AdvancedSettingsMigrationStatus,
    AdvancedSettingsNormalizationOptions,
    AdvancedSettingsProfile,
    EffectiveProductRules,
    MatchingAdvancedSettings,
    PricingAdvancedSettings,
    ProductRulesOverride,
    WeightedAdvancedSettings,
    WeightedAdvancedSettingsOverride,
} from "./advanced-settings-contracts"
import {
    getWeightedFallbackPvpField as getNormalizedWeightedFallbackPvpField,
    mergeWeightedAdvancedSettings,
    normalizeDeletePolicyAdvancedSettings,
    normalizeInvoicingAdvancedSettings,
    normalizeMatchingAdvancedSettings,
    normalizePartialInvoicingAdvancedSettings,
    normalizePartialPricingAdvancedSettings,
    normalizePartialStockAdvancedSettings,
    normalizePartialWeightedAdvancedSettings,
    normalizePricingAdvancedSettings,
    normalizeStockAdvancedSettings,
    normalizeSyncBehaviorAdvancedSettings,
    normalizeWeightedAdvancedSettings,
} from "./advanced-settings-normalizers"
import { explainWeightedPriceStrategy } from "./weighted-price-strategies"
export * from "./advanced-settings-contracts"

type AdvancedContificoSettingsInput = Partial<
    Omit<AdvancedContificoSettings, "weighted">
> & {
    weighted?: WeightedAdvancedSettingsOverride | null
}

export const DEFAULT_ADVANCED_SETTINGS: AdvancedContificoSettings = {
    version: 2,
    migration_status: "native_v2",
    matching: {
        priority: ["sku", "barcode", "exact_name", "similar_name"],
        similarity_threshold: 0.8,
        allow_auto_link: true,
        exclude_if_multiple_candidates: true,
    },
    pricing: {
        default_pvp_field: "pvp1",
        rounding_mode: "2_decimals",
        markup_percent: null,
        minimum_price: null,
    },
    weighted: {
        enabled: false,
        weight_source: "variant_weight_with_metadata_override",
        invoice_grouping: "group_by_contifico_product",
        block_if_missing_weight: true,
        allow_weighted_price_sync: true,
        pricing_strategy: "fixed_pvp_field",
        strategy_config: {
            field: "pvp1",
        },
        creation_mode: "manual_only",
        default_profile_id: null,
        creation_profiles: [],
    },
    stock: {
        mode: "normal",
        mismatch_policy: "use_total_stock",
    },
    invoicing: {
        on_missing_mapping: "error",
        on_missing_weighted_data: "error",
        reference_template: "MEDUSA-ORD-{display_id}",
        description_template: "Pedido Medusa #{display_id}",
    },
    delete_policy: {
        product_delete_scope: "plugin_created_only",
        require_preview: true,
    },
    sync_behavior: {
        dry_run_enabled: true,
        log_decisions: true,
    },
}

export function getAdvancedSettingsProfile(
    profile: AdvancedSettingsProfile
): AdvancedContificoSettings {
    switch (profile) {
        case "weighted":
            return normalizeAdvancedSettings({
                ...DEFAULT_ADVANCED_SETTINGS,
                weighted: {
                    ...DEFAULT_ADVANCED_SETTINGS.weighted,
                    enabled: true,
                },
                stock: {
                    ...DEFAULT_ADVANCED_SETTINGS.stock,
                    mode: "report_only",
                },
            })
        case "manual":
            return normalizeAdvancedSettings({
                ...DEFAULT_ADVANCED_SETTINGS,
                matching: {
                    ...DEFAULT_ADVANCED_SETTINGS.matching,
                    allow_auto_link: false,
                },
                sync_behavior: {
                    ...DEFAULT_ADVANCED_SETTINGS.sync_behavior,
                    dry_run_enabled: true,
                },
            })
        default:
            return normalizeAdvancedSettings(DEFAULT_ADVANCED_SETTINGS)
    }
}

export function parseAdvancedSettings(
    value: string | null | undefined,
    options?: AdvancedSettingsNormalizationOptions
): AdvancedContificoSettings {
    return normalizeAdvancedSettings(
        safeJsonParse<AdvancedContificoSettingsInput | null>(value, null),
        options
    )
}

export function normalizeAdvancedSettings(
    value:
        | AdvancedContificoSettingsInput
        | AdvancedContificoSettings
        | null
        | undefined,
    options?: AdvancedSettingsNormalizationOptions
): AdvancedContificoSettings {
    const input = (asRecord(value) || {}) as AdvancedContificoSettingsInput
    const defaultWeightedPvpField =
        isWeightedPvpField(options?.default_weighted_pvp_field)
            ? options.default_weighted_pvp_field
            : DEFAULT_ADVANCED_SETTINGS.pricing.default_pvp_field

    const pricing = normalizePricingAdvancedSettings(
        input?.pricing,
        DEFAULT_ADVANCED_SETTINGS.pricing,
        defaultWeightedPvpField
    )
    const weighted = normalizeWeightedAdvancedSettings(
        input?.weighted,
        DEFAULT_ADVANCED_SETTINGS.weighted,
        pricing.default_pvp_field,
        {
            ...options,
            default_weighted_pvp_field: pricing.default_pvp_field,
        }
    )
    const hasLegacyWeightedRules =
        Array.isArray(input.weighted?.pvp_field_by_grams) &&
        input.weighted.pvp_field_by_grams.length > 0
    const migrationStatus: AdvancedSettingsMigrationStatus =
        input?.version === 2 &&
        !hasLegacyWeightedRules &&
        input.migration_status !== "migrated_v2"
            ? "native_v2"
            : "migrated_v2"

    return {
        version: 2,
        migration_status: migrationStatus,
        matching: normalizeMatchingAdvancedSettings(
            input?.matching,
            DEFAULT_ADVANCED_SETTINGS.matching
        ),
        pricing,
        weighted,
        stock: normalizeStockAdvancedSettings(
            input?.stock,
            DEFAULT_ADVANCED_SETTINGS.stock
        ),
        invoicing: normalizeInvoicingAdvancedSettings(
            input?.invoicing,
            DEFAULT_ADVANCED_SETTINGS.invoicing
        ),
        delete_policy: normalizeDeletePolicyAdvancedSettings(
            input?.delete_policy,
            DEFAULT_ADVANCED_SETTINGS.delete_policy
        ),
        sync_behavior: normalizeSyncBehaviorAdvancedSettings(
            input?.sync_behavior,
            DEFAULT_ADVANCED_SETTINGS.sync_behavior
        ),
    }
}

export function resolveEffectiveProductRules(
    advanced: AdvancedContificoSettings,
    override?: ProductRulesOverride | null
): EffectiveProductRules {
    const pricing = normalizePricingAdvancedSettings(
        {
            ...advanced.pricing,
            ...(override?.pricing || {}),
        },
        DEFAULT_ADVANCED_SETTINGS.pricing,
        advanced.pricing.default_pvp_field
    )

    return {
        pricing,
        weighted: mergeWeightedAdvancedSettings(
            advanced.weighted,
            override?.weighted,
            DEFAULT_ADVANCED_SETTINGS.weighted,
            pricing.default_pvp_field
        ),
        stock: normalizeStockAdvancedSettings(
            {
                ...advanced.stock,
                ...(override?.stock || {}),
            },
            DEFAULT_ADVANCED_SETTINGS.stock
        ),
        invoicing: normalizeInvoicingAdvancedSettings(
            {
                ...advanced.invoicing,
                ...(override?.invoicing || {}),
            },
            DEFAULT_ADVANCED_SETTINGS.invoicing
        ),
    }
}

export function normalizeProductRulesOverride(
    override: ProductRulesOverride | null | undefined,
    options?: {
        default_weighted_pvp_field?: WeightedPvpField
    }
): ProductRulesOverride | undefined {
    if (!override) {
        return undefined
    }

    const defaultWeightedPvpField =
        options?.default_weighted_pvp_field ||
        DEFAULT_ADVANCED_SETTINGS.pricing.default_pvp_field
    const pricing = override.pricing
        ? normalizePartialPricingAdvancedSettings(
              override.pricing,
              defaultWeightedPvpField
          )
        : undefined
    const pricingFallback =
        pricing?.default_pvp_field || defaultWeightedPvpField
    const weighted = override.weighted
        ? normalizePartialWeightedAdvancedSettings(
              override.weighted,
              pricingFallback
          )
        : undefined
    const stock = override.stock
        ? normalizePartialStockAdvancedSettings(override.stock)
        : undefined
    const invoicing = override.invoicing
        ? normalizePartialInvoicingAdvancedSettings(override.invoicing)
        : undefined

    const next: ProductRulesOverride = {}
    if (pricing && hasKeys(pricing)) {
        next.pricing = pricing
    }
    if (weighted && hasKeys(weighted)) {
        next.weighted = weighted
    }
    if (stock && hasKeys(stock)) {
        next.stock = stock
    }
    if (invoicing && hasKeys(invoicing)) {
        next.invoicing = invoicing
    }

    return hasKeys(next) ? next : undefined
}

export function getWeightedFallbackPvpField(
    weighted: WeightedAdvancedSettings
): WeightedPvpField {
    return getNormalizedWeightedFallbackPvpField(weighted)
}

export function getWeightedPriceStrategyExplanation(
    weighted: WeightedAdvancedSettings
) {
    return explainWeightedPriceStrategy(
        weighted.pricing_strategy,
        weighted.strategy_config
    )
}

export function serializeAdvancedSettings(
    value: AdvancedContificoSettings | null | undefined
): string | null {
    return value ? JSON.stringify(normalizeAdvancedSettings(value)) : null
}

function isWeightedPvpField(value: unknown): value is WeightedPvpField {
    return ["pvp1", "pvp2", "pvp3", "pvp4"].includes(
        value as WeightedPvpField
    )
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function hasKeys(value: object | null | undefined): boolean {
    return !!value && Object.keys(value).length > 0
}
