import { fromCSV, toCSV } from "./csv"
import {
    getWeightedFallbackPvpField,
    normalizeAdvancedSettings,
    parseAdvancedSettings,
    serializeAdvancedSettings,
    type AdvancedContificoSettings,
} from "./advanced-settings"
import type { ImportFilterConfig } from "./contifico-filters"
import { safeJsonParse } from "./json"
import { hasKeys } from "./utils"

export const VARIANT_MODE_VALUES = ["auto", "contifico", "simple", "weighted"] as const
export type VariantMode = (typeof VARIANT_MODE_VALUES)[number]
export const WEIGHTED_PVP_FIELD_VALUES = ["pvp1", "pvp2", "pvp3", "pvp4"] as const
export type WeightedPvpField = (typeof WEIGHTED_PVP_FIELD_VALUES)[number]

export interface ContificoConfigRecord {
    id: string
    api_key: string
    api_pos: string | null
    bodega_ids: string | null
    sync_products_enabled: boolean
    sync_customers_enabled: boolean
    auto_invoice_enabled: boolean
    auto_preinvoice_enabled: boolean
    sync_interval_minutes: number
    manage_inventory: boolean
    allow_backorder: boolean
    sales_channel_id: string | null
    shipping_profile_id: string | null
    variant_mode: string | null
    weighted_pvp_field: string | null
    advanced_settings: string | null
    invoice_test_mode: boolean
    last_product_sync: string | null
    last_customer_sync: string | null
    import_filters: string | null
}

export interface NormalizedContificoConfig
    extends Omit<
        ContificoConfigRecord,
        "bodega_ids" | "import_filters" | "variant_mode" | "weighted_pvp_field" | "advanced_settings"
    > {
    bodega_ids: string[]
    import_filters: ImportFilterConfig | null
    variant_mode: VariantMode
    weighted_pvp_field: WeightedPvpField
    advanced_settings: AdvancedContificoSettings
}

export interface ContificoConfigWriteInput {
    api_key: string
    api_pos?: string | null
    bodega_ids?: string[]
    sync_products_enabled?: boolean
    sync_customers_enabled?: boolean
    auto_invoice_enabled?: boolean
    auto_preinvoice_enabled?: boolean
    sync_interval_minutes?: number
    manage_inventory?: boolean
    allow_backorder?: boolean
    sales_channel_id?: string | null
    shipping_profile_id?: string | null
    variant_mode?: VariantMode
    weighted_pvp_field?: WeightedPvpField
    advanced_settings?: AdvancedContificoSettings | null
    invoice_test_mode?: boolean
    import_filters?: ImportFilterConfig | null
}

export interface ContificoConfigMigrationPatch {
    variant_mode?: VariantMode
    weighted_pvp_field?: WeightedPvpField
    advanced_settings?: string | null
}

export function normalizeContificoConfig(
    config: ContificoConfigRecord | null | undefined
): NormalizedContificoConfig | null {
    if (!config) {
        return null
    }

    const variantMode = isVariantMode(config.variant_mode)
        ? config.variant_mode
        : "auto"
    const weightedPvpField = isWeightedPvpField(config.weighted_pvp_field)
        ? config.weighted_pvp_field
        : "pvp1"
    const advancedSettings = normalizeAdvancedSettings(
        parseAdvancedSettings(config.advanced_settings, {
            default_weighted_pvp_field: weightedPvpField,
            default_weighted_enabled: variantMode === "weighted",
        }),
        {
            default_weighted_pvp_field: weightedPvpField,
            default_weighted_enabled: variantMode === "weighted",
        }
    )
    const normalizedWeightedPvpField = getWeightedFallbackPvpField(
        advancedSettings.weighted
    )

    return {
        ...config,
        bodega_ids: fromCSV(config.bodega_ids),
        import_filters: safeJsonParse<ImportFilterConfig | null>(
            config.import_filters,
            null
        ),
        variant_mode: advancedSettings.weighted.enabled ? "weighted" : variantMode,
        weighted_pvp_field: normalizedWeightedPvpField,
        advanced_settings: advancedSettings,
    }
}

export function getContificoConfigMigrationPatch(
    config: ContificoConfigRecord | null | undefined
): ContificoConfigMigrationPatch | null {
    const normalized = normalizeContificoConfig(config)

    if (!config || !normalized) {
        return null
    }

    const patch: ContificoConfigMigrationPatch = {}
    const serializedAdvancedSettings = serializeAdvancedSettings(
        normalized.advanced_settings
    )

    if (serializedAdvancedSettings !== config.advanced_settings) {
        patch.advanced_settings = serializedAdvancedSettings
    }

    if (normalized.variant_mode !== config.variant_mode) {
        patch.variant_mode = normalized.variant_mode
    }

    if (normalized.weighted_pvp_field !== config.weighted_pvp_field) {
        patch.weighted_pvp_field = normalized.weighted_pvp_field
    }

    return hasKeys(patch) ? patch : null
}

export function serializeContificoConfigInput(
    input: ContificoConfigWriteInput
): Omit<ContificoConfigWriteInput, "bodega_ids" | "import_filters" | "advanced_settings"> & {
    bodega_ids?: string | null
    import_filters?: string | null
    advanced_settings?: string | null
} {
    return {
        ...input,
        bodega_ids:
            input.bodega_ids === undefined ? undefined : toCSV(input.bodega_ids),
        advanced_settings:
            input.advanced_settings === undefined
                ? undefined
                : serializeAdvancedSettings(input.advanced_settings),
        import_filters:
            input.import_filters === undefined
                ? undefined
                : input.import_filters
                    ? JSON.stringify(input.import_filters)
                    : null,
    }
}

export function isVariantMode(value: string | null | undefined): value is VariantMode {
    return !!value && VARIANT_MODE_VALUES.includes(value as VariantMode)
}

export function isWeightedPvpField(
    value: string | null | undefined
): value is WeightedPvpField {
    return !!value && WEIGHTED_PVP_FIELD_VALUES.includes(value as WeightedPvpField)
}


