import type { WeightedPvpField } from "./contifico-config"
import type {
    WeightedPriceStrategy,
    WeightedPriceStrategyConfig,
    WeightedPvpByGramsRule,
} from "./weighted-price-strategies"
import type {
    WeightedCreationMode,
    WeightedPresentationProfile,
} from "./weighted-presentation-profiles"

export const MATCH_PRIORITY_VALUES = [
    "sku",
    "barcode",
    "exact_name",
    "similar_name",
] as const

export const ROUNDING_MODE_VALUES = [
    "none",
    "2_decimals",
    "commercial_05",
    "commercial_10",
] as const

export const STOCK_MODE_VALUES = [
    "normal",
    "report_only",
    "manual",
    "primary_only",
] as const

export const STOCK_MISMATCH_POLICY_VALUES = [
    "use_total_stock",
    "use_bodega_sum",
    "warn_only",
] as const

export const INVOICE_MISSING_MAPPING_VALUES = ["error", "skip_line"] as const

export const DELETE_SCOPE_VALUES = ["plugin_created_only"] as const

export type MatchPriority = (typeof MATCH_PRIORITY_VALUES)[number]
export type RoundingMode = (typeof ROUNDING_MODE_VALUES)[number]
export type StockMode = (typeof STOCK_MODE_VALUES)[number]
export type StockMismatchPolicy = (typeof STOCK_MISMATCH_POLICY_VALUES)[number]
export type InvoiceMissingMapping =
    (typeof INVOICE_MISSING_MAPPING_VALUES)[number]
export type DeleteScope = (typeof DELETE_SCOPE_VALUES)[number]

export type AdvancedSettingsMigrationStatus = "native_v2" | "migrated_v2"
export type AdvancedSettingsProfile = "standard" | "weighted" | "manual"

export interface MatchingAdvancedSettings {
    priority: MatchPriority[]
    similarity_threshold: number
    allow_auto_link: boolean
    exclude_if_multiple_candidates: boolean
}

export interface PricingAdvancedSettings {
    default_pvp_field: WeightedPvpField
    rounding_mode: RoundingMode
    markup_percent: number | null
    minimum_price: number | null
}

export interface WeightedAdvancedSettings {
    enabled: boolean
    weight_source: "variant_weight_with_metadata_override"
    invoice_grouping: "group_by_contifico_product"
    block_if_missing_weight: boolean
    allow_weighted_price_sync: boolean
    pricing_strategy: WeightedPriceStrategy
    strategy_config: WeightedPriceStrategyConfig
    creation_mode: WeightedCreationMode
    default_profile_id: string | null
    creation_profiles: WeightedPresentationProfile[]
}

export interface StockAdvancedSettings {
    mode: StockMode
    mismatch_policy: StockMismatchPolicy
}

export interface InvoicingAdvancedSettings {
    on_missing_mapping: InvoiceMissingMapping
    on_missing_weighted_data: "error"
    reference_template: string
    description_template: string
}

export interface DeletePolicyAdvancedSettings {
    product_delete_scope: DeleteScope
    require_preview: boolean
}

export interface SyncBehaviorAdvancedSettings {
    dry_run_enabled: boolean
    log_decisions: boolean
}

export interface AdvancedContificoSettings {
    version: 2
    migration_status: AdvancedSettingsMigrationStatus
    matching: MatchingAdvancedSettings
    pricing: PricingAdvancedSettings
    weighted: WeightedAdvancedSettings
    stock: StockAdvancedSettings
    invoicing: InvoicingAdvancedSettings
    delete_policy: DeletePolicyAdvancedSettings
    sync_behavior: SyncBehaviorAdvancedSettings
}

export type WeightedStrategyConfigOverride =
    | Partial<WeightedPriceStrategyConfig>
    | null

export interface WeightedAdvancedSettingsOverride
    extends Partial<Omit<WeightedAdvancedSettings, "strategy_config">> {
    strategy_config?: WeightedStrategyConfigOverride
    pvp_field_by_grams?: WeightedPvpByGramsRule[] | null
}

export interface ProductRulesOverride {
    pricing?: Partial<PricingAdvancedSettings> | null
    weighted?: WeightedAdvancedSettingsOverride | null
    stock?: Partial<StockAdvancedSettings> | null
    invoicing?: Partial<InvoicingAdvancedSettings> | null
}

export interface EffectiveProductRules {
    pricing: PricingAdvancedSettings
    weighted: WeightedAdvancedSettings
    stock: StockAdvancedSettings
    invoicing: InvoicingAdvancedSettings
}

export interface StrategyDecision<TValue> {
    strategy: string
    value: TValue
    reason: string
    warnings?: string[]
}

export interface PreviewResult<TSummary = Record<string, unknown>> {
    ok: boolean
    summary: TSummary
    decisions: Array<StrategyDecision<unknown>>
    warnings: string[]
    blockers: string[]
}

export interface AdvancedSettingsNormalizationOptions {
    default_weighted_pvp_field?: WeightedPvpField
    default_weighted_enabled?: boolean
}
