import {
    getWeightedFallbackPvpField,
    normalizeAdvancedSettings,
    type AdvancedContificoSettings,
} from "../../../lib/advanced-settings"
import {
    CONTIFICO_CONFIG_GATES,
    resolveConfigGate,
    type ConfigUiContext,
} from "../../../lib/config-gates"
import type { WeightedPvpField } from "../../../lib/contifico-config"
import type { RulesByWeightStrategyConfig } from "../../../lib/weighted-price-strategies"

export function parseControllerAdvancedSettings(
    advancedSettingsJson: string
): AdvancedContificoSettings | null {
    try {
        return normalizeAdvancedSettings(
            advancedSettingsJson.trim()
                ? JSON.parse(advancedSettingsJson)
                : undefined
        )
    } catch {
        return null
    }
}

export function getDerivedWeightedSettings(
    parsedAdvancedSettings: AdvancedContificoSettings | null,
    weightedPvpField: WeightedPvpField
) {
    const weightedPriceStrategy =
        parsedAdvancedSettings?.weighted.pricing_strategy || "fixed_pvp_field"
    const weightedPvpRules =
        weightedPriceStrategy === "rules_by_weight"
            ? (
                  (parsedAdvancedSettings?.weighted
                      .strategy_config as RulesByWeightStrategyConfig | undefined)
                      ?.rules || []
              )
            : []
    const weightedCreationMode =
        parsedAdvancedSettings?.weighted.creation_mode || "manual_only"
    const weightedCreationProfiles =
        parsedAdvancedSettings?.weighted.creation_profiles || []

    return {
        weightedCreationMode,
        weightedCreationProfiles,
        weightedDefaultProfileId:
            parsedAdvancedSettings?.weighted.default_profile_id || "",
        weightedFallbackField: parsedAdvancedSettings?.weighted
            ? getWeightedFallbackPvpField(parsedAdvancedSettings.weighted)
            : weightedPvpField,
        weightedPriceStrategy,
        weightedPvpRules,
    }
}

export function resolveControllerGates(context: ConfigUiContext) {
    return {
        autoInvoiceGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.auto_invoice,
            context
        ),
        deleteImportedProductsGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.delete_imported_products,
            context
        ),
        productSyncActionsGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.product_sync_actions,
            context
        ),
        syncIntervalGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.sync_interval,
            context
        ),
        weightedCreationModeGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.weighted_creation_mode,
            context
        ),
        weightedCreationProfilesGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.weighted_creation_profiles,
            context
        ),
        weightedFixedFieldGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.weighted_fixed_field,
            context
        ),
        weightedPriceLockGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.weighted_price_lock,
            context
        ),
        weightedRulesGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.weighted_rules,
            context
        ),
        weightedStrategyGate: resolveConfigGate(
            CONTIFICO_CONFIG_GATES.weighted_strategy,
            context
        ),
    }
}
