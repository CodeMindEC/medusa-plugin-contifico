import {
    explainWeightedPriceStrategy,
    isStrategyWeightedPvpField,
    isWeightedPriceStrategy,
    normalizeWeightedPriceStrategyConfig,
    type RulesByWeightStrategyConfig,
    type WeightedPriceStrategy,
    type WeightedPriceStrategyConfig,
    type WeightedPvpByGramsRule,
} from "./weighted-price-strategies"
import {
    isWeightedCreationMode,
    normalizeWeightedCreationMode,
    normalizeWeightedPresentationProfiles,
} from "./weighted-presentation-profiles"
import {
    INVOICE_MISSING_MAPPING_VALUES,
    MATCH_PRIORITY_VALUES,
    ROUNDING_MODE_VALUES,
    STOCK_MISMATCH_POLICY_VALUES,
    STOCK_MODE_VALUES,
} from "./advanced-settings-contracts"
import type {
    AdvancedSettingsNormalizationOptions,
    DeletePolicyAdvancedSettings,
    InvoicingAdvancedSettings,
    InvoiceMissingMapping,
    MatchingAdvancedSettings,
    MatchPriority,
    PricingAdvancedSettings,
    RoundingMode,
    StockAdvancedSettings,
    StockMismatchPolicy,
    StockMode,
    SyncBehaviorAdvancedSettings,
    WeightedAdvancedSettings,
    WeightedAdvancedSettingsOverride,
} from "./advanced-settings-contracts"
import type { WeightedPvpField } from "./contifico-config"

export function normalizeMatchingAdvancedSettings(
    value: Partial<MatchingAdvancedSettings> | null | undefined,
    defaults: MatchingAdvancedSettings
): MatchingAdvancedSettings {
    return {
        ...defaults,
        ...(value || {}),
        priority: normalizeMatchPriority(value?.priority, defaults.priority),
        similarity_threshold: normalizeThreshold(
            value?.similarity_threshold,
            defaults.similarity_threshold
        ),
    }
}

export function normalizePricingAdvancedSettings(
    value: Partial<PricingAdvancedSettings> | null | undefined,
    defaults: PricingAdvancedSettings,
    fallbackField: WeightedPvpField
): PricingAdvancedSettings {
    return {
        ...defaults,
        ...(value || {}),
        default_pvp_field: isWeightedPvpField(value?.default_pvp_field)
            ? value.default_pvp_field
            : fallbackField,
        rounding_mode: isRoundingMode(value?.rounding_mode)
            ? value.rounding_mode
            : defaults.rounding_mode,
        markup_percent: normalizeNullableNumber(value?.markup_percent),
        minimum_price: normalizeNullableNumber(value?.minimum_price),
    }
}

export function normalizeWeightedAdvancedSettings(
    value: WeightedAdvancedSettingsOverride | null | undefined,
    defaults: WeightedAdvancedSettings,
    fallbackField: WeightedPvpField,
    options?: AdvancedSettingsNormalizationOptions
): WeightedAdvancedSettings {
    const legacyRules = normalizeLegacyWeightedRules(value?.pvp_field_by_grams)
    const pricingStrategy = isWeightedPriceStrategy(value?.pricing_strategy)
        ? value.pricing_strategy
        : legacyRules.length > 0
          ? "rules_by_weight"
          : defaults.pricing_strategy
    const strategyConfig = normalizeWeightedPriceStrategyConfig(
        pricingStrategy,
        value?.strategy_config,
        {
            fallback_field: fallbackField,
            legacy_rules: legacyRules,
        }
    )
    const creationProfiles = normalizeWeightedPresentationProfiles(
        value?.creation_profiles
    )
    const requestedDefaultProfileId =
        typeof value?.default_profile_id === "string" &&
        value.default_profile_id.trim().length > 0
            ? value.default_profile_id.trim()
            : null
    const defaultProfileId = creationProfiles.some(
        (profile) => profile.id === requestedDefaultProfileId
    )
        ? requestedDefaultProfileId
        : creationProfiles.length === 1
          ? creationProfiles[0].id
          : null

    return {
        ...defaults,
        enabled: value?.enabled ?? options?.default_weighted_enabled ?? defaults.enabled,
        weight_source: "variant_weight_with_metadata_override",
        invoice_grouping: "group_by_contifico_product",
        block_if_missing_weight:
            value?.block_if_missing_weight ?? defaults.block_if_missing_weight,
        allow_weighted_price_sync:
            value?.allow_weighted_price_sync ?? defaults.allow_weighted_price_sync,
        pricing_strategy: pricingStrategy,
        strategy_config: strategyConfig,
        creation_mode: normalizeWeightedCreationMode(
            value?.creation_mode,
            defaults.creation_mode
        ),
        default_profile_id: defaultProfileId,
        creation_profiles: creationProfiles,
    }
}

export function mergeWeightedAdvancedSettings(
    base: WeightedAdvancedSettings,
    override: WeightedAdvancedSettingsOverride | null | undefined,
    defaults: WeightedAdvancedSettings,
    fallbackField: WeightedPvpField,
    options?: AdvancedSettingsNormalizationOptions
): WeightedAdvancedSettings {
    if (!override) {
        return normalizeWeightedAdvancedSettings(base, defaults, fallbackField, options)
    }

    const nextStrategy = isWeightedPriceStrategy(override.pricing_strategy)
        ? override.pricing_strategy
        : base.pricing_strategy
    const strategyConfig =
        override.strategy_config === undefined &&
        override.pvp_field_by_grams === undefined
            ? base.strategy_config
            : buildMergedWeightedStrategyConfig(
                  base,
                  override,
                  nextStrategy,
                  fallbackField
              )

    return normalizeWeightedAdvancedSettings(
        {
            ...base,
            ...override,
            pricing_strategy: nextStrategy,
            strategy_config: strategyConfig,
        },
        defaults,
        fallbackField,
        options
    )
}

export function normalizeStockAdvancedSettings(
    value: Partial<StockAdvancedSettings> | null | undefined,
    defaults: StockAdvancedSettings
): StockAdvancedSettings {
    return {
        ...defaults,
        ...(value || {}),
        mode: isStockMode(value?.mode) ? value.mode : defaults.mode,
        mismatch_policy: isStockMismatchPolicy(value?.mismatch_policy)
            ? value.mismatch_policy
            : defaults.mismatch_policy,
    }
}

export function normalizeInvoicingAdvancedSettings(
    value: Partial<InvoicingAdvancedSettings> | null | undefined,
    defaults: InvoicingAdvancedSettings
): InvoicingAdvancedSettings {
    return {
        ...defaults,
        ...(value || {}),
        on_missing_mapping: isInvoiceMissingMapping(value?.on_missing_mapping)
            ? value.on_missing_mapping
            : defaults.on_missing_mapping,
        on_missing_weighted_data: "error",
        reference_template: value?.reference_template || defaults.reference_template,
        description_template:
            value?.description_template || defaults.description_template,
    }
}

export function normalizeDeletePolicyAdvancedSettings(
    value: Partial<DeletePolicyAdvancedSettings> | null | undefined,
    defaults: DeletePolicyAdvancedSettings
): DeletePolicyAdvancedSettings {
    return {
        ...defaults,
        ...(value || {}),
        product_delete_scope: "plugin_created_only",
        require_preview: value?.require_preview ?? defaults.require_preview,
    }
}

export function normalizeSyncBehaviorAdvancedSettings(
    value: Partial<SyncBehaviorAdvancedSettings> | null | undefined,
    defaults: SyncBehaviorAdvancedSettings
): SyncBehaviorAdvancedSettings {
    return {
        ...defaults,
        ...(value || {}),
    }
}

export function normalizePartialPricingAdvancedSettings(
    value: Partial<PricingAdvancedSettings>,
    fallbackField: WeightedPvpField
): Partial<PricingAdvancedSettings> | undefined {
    const next: Partial<PricingAdvancedSettings> = {}

    if (isWeightedPvpField(value.default_pvp_field)) {
        next.default_pvp_field = value.default_pvp_field
    }
    if (isRoundingMode(value.rounding_mode)) {
        next.rounding_mode = value.rounding_mode
    }
    if (value.markup_percent === null || typeof value.markup_percent === "number") {
        next.markup_percent = normalizeNullableNumber(value.markup_percent)
    }
    if (value.minimum_price === null || typeof value.minimum_price === "number") {
        next.minimum_price = normalizeNullableNumber(value.minimum_price)
    }
    if (!next.default_pvp_field && fallbackField) {
        delete next.default_pvp_field
    }

    return hasKeys(next) ? next : undefined
}

export function normalizePartialWeightedAdvancedSettings(
    value: WeightedAdvancedSettingsOverride,
    fallbackField: WeightedPvpField
): WeightedAdvancedSettingsOverride | undefined {
    const next: WeightedAdvancedSettingsOverride = {}

    if (typeof value.enabled === "boolean") {
        next.enabled = value.enabled
    }
    if (typeof value.block_if_missing_weight === "boolean") {
        next.block_if_missing_weight = value.block_if_missing_weight
    }
    if (typeof value.allow_weighted_price_sync === "boolean") {
        next.allow_weighted_price_sync = value.allow_weighted_price_sync
    }
    if (isWeightedCreationMode(value.creation_mode)) {
        next.creation_mode = value.creation_mode
    }
    if (value.default_profile_id === null || typeof value.default_profile_id === "string") {
        next.default_profile_id = value.default_profile_id
    }
    if (value.creation_profiles !== undefined) {
        next.creation_profiles = normalizeWeightedPresentationProfiles(
            value.creation_profiles
        )
    }
    if (isWeightedPriceStrategy(value.pricing_strategy)) {
        next.pricing_strategy = value.pricing_strategy
    }
    if (value.strategy_config !== undefined || value.pvp_field_by_grams !== undefined) {
        const strategy =
            next.pricing_strategy ||
            (isWeightedPriceStrategy(value.pricing_strategy)
                ? value.pricing_strategy
                : "fixed_pvp_field")
        next.strategy_config = normalizeWeightedPriceStrategyConfig(
            strategy,
            value.strategy_config,
            {
                fallback_field: fallbackField,
                legacy_rules: normalizeLegacyWeightedRules(value.pvp_field_by_grams),
            }
        )
    }

    return hasKeys(next) ? next : undefined
}

export function normalizePartialStockAdvancedSettings(
    value: Partial<StockAdvancedSettings>
): Partial<StockAdvancedSettings> | undefined {
    const next: Partial<StockAdvancedSettings> = {}
    if (isStockMode(value.mode)) {
        next.mode = value.mode
    }
    if (isStockMismatchPolicy(value.mismatch_policy)) {
        next.mismatch_policy = value.mismatch_policy
    }
    return hasKeys(next) ? next : undefined
}

export function normalizePartialInvoicingAdvancedSettings(
    value: Partial<InvoicingAdvancedSettings>
): Partial<InvoicingAdvancedSettings> | undefined {
    const next: Partial<InvoicingAdvancedSettings> = {}
    if (isInvoiceMissingMapping(value.on_missing_mapping)) {
        next.on_missing_mapping = value.on_missing_mapping
    }
    if (value.reference_template) {
        next.reference_template = value.reference_template
    }
    if (value.description_template) {
        next.description_template = value.description_template
    }
    return hasKeys(next) ? next : undefined
}

export function getWeightedFallbackPvpField(
    weighted: WeightedAdvancedSettings
): WeightedPvpField {
    return explainWeightedPriceStrategy(
        weighted.pricing_strategy,
        weighted.strategy_config
    ).fallback_field as WeightedPvpField
}

function buildMergedWeightedStrategyConfig(
    base: WeightedAdvancedSettings,
    override: WeightedAdvancedSettingsOverride,
    strategy: WeightedPriceStrategy,
    fallbackField: WeightedPvpField
): WeightedPriceStrategyConfig {
    const legacyRules = normalizeLegacyWeightedRules(override.pvp_field_by_grams)
    if (strategy !== base.pricing_strategy || override.strategy_config == null) {
        return normalizeWeightedPriceStrategyConfig(strategy, override.strategy_config, {
            fallback_field: fallbackField,
            legacy_rules: legacyRules,
        })
    }
    if (strategy === "fixed_pvp_field") {
        return normalizeWeightedPriceStrategyConfig(
            strategy,
            {
                ...(base.strategy_config as { field: WeightedPvpField }),
                ...(override.strategy_config as Partial<{ field: WeightedPvpField }>),
            },
            {
                fallback_field: fallbackField,
                legacy_rules: legacyRules,
            }
        )
    }

    const baseRulesConfig = base.strategy_config as RulesByWeightStrategyConfig
    const overrideRulesConfig =
        (override.strategy_config as Partial<RulesByWeightStrategyConfig>) || {}

    return normalizeWeightedPriceStrategyConfig(
        strategy,
        {
            ...baseRulesConfig,
            ...overrideRulesConfig,
            rules:
                overrideRulesConfig.rules ??
                (legacyRules.length > 0 ? legacyRules : baseRulesConfig.rules),
        },
        {
            fallback_field: fallbackField,
            legacy_rules: legacyRules,
        }
    )
}

function normalizeMatchPriority(
    value: MatchPriority[] | undefined,
    fallback: MatchPriority[]
): MatchPriority[] {
    const list = Array.isArray(value)
        ? value.filter((item): item is MatchPriority =>
              MATCH_PRIORITY_VALUES.includes(item)
          )
        : []
    return list.length > 0 ? list : [...fallback]
}

function normalizeThreshold(value: number | undefined, fallback: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return fallback
    }
    return Math.min(1, Math.max(0, value))
}

function normalizeNullableNumber(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

function normalizeLegacyWeightedRules(
    value: WeightedPvpByGramsRule[] | null | undefined
): WeightedPvpByGramsRule[] {
    return Array.isArray(value)
        ? value
              .map((rule) => ({
                  grams: normalizePositiveNumber(rule?.grams),
                  field: isStrategyWeightedPvpField(rule?.field)
                      ? rule.field
                      : null,
              }))
              .filter(
                  (
                      rule
                  ): rule is {
                      grams: number
                      field: WeightedPvpField
                  } => rule.grams != null && rule.field != null
              )
        : []
}

function normalizePositiveNumber(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : null
}

function isWeightedPvpField(value: unknown): value is WeightedPvpField {
    return isStrategyWeightedPvpField(value)
}

function isRoundingMode(value: unknown): value is RoundingMode {
    return ROUNDING_MODE_VALUES.includes(value as RoundingMode)
}

function isStockMode(value: unknown): value is StockMode {
    return STOCK_MODE_VALUES.includes(value as StockMode)
}

function isStockMismatchPolicy(value: unknown): value is StockMismatchPolicy {
    return STOCK_MISMATCH_POLICY_VALUES.includes(value as StockMismatchPolicy)
}

function isInvoiceMissingMapping(value: unknown): value is InvoiceMissingMapping {
    return INVOICE_MISSING_MAPPING_VALUES.includes(value as InvoiceMissingMapping)
}

function hasKeys(value: object | null | undefined): boolean {
    return !!value && Object.keys(value).length > 0
}
