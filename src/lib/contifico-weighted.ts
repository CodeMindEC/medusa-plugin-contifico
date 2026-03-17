import type { NormalizedContificoConfig, VariantMode, WeightedPvpField } from "./contifico-config"
import {
    getWeightedFallbackPvpField,
    type WeightedAdvancedSettings,
} from "./advanced-settings"
import type { ProductEntityMapMetadata } from "./contifico-metadata"
import {
    resolveWeightedPriceStrategyField,
    type RulesByWeightStrategyConfig,
    type WeightedPriceStrategyConfig,
} from "./weighted-price-strategies"
import type { ContificoProducto } from "./types"

export const CONTIFICO_WEIGHT_METADATA_KEY = "contifico_weight_grams"

type MetadataCarrier = {
    metadata?: Record<string, unknown> | null
    weight?: number | null
}

export function getEffectiveMappingMode(
    config: Pick<NormalizedContificoConfig, "variant_mode">,
    metadata?: ProductEntityMapMetadata | null
): VariantMode {
    return metadata?.mapping_mode_override || config.variant_mode
}

export function getEffectiveWeightedPvpField(
    config: Pick<NormalizedContificoConfig, "weighted_pvp_field">,
    metadata?: ProductEntityMapMetadata | null
): WeightedPvpField {
    return metadata?.weighted_pvp_field || config.weighted_pvp_field
}

export function resolveWeightedPvpField(
    config: Pick<NormalizedContificoConfig, "weighted_pvp_field">,
    weighted: Pick<
        WeightedAdvancedSettings,
        "pricing_strategy" | "strategy_config"
    >,
    grams: number | null | undefined,
    metadata?: ProductEntityMapMetadata | null
): WeightedPvpField {
    if (
        metadata?.weighted_pvp_field &&
        weighted.pricing_strategy === "fixed_pvp_field"
    ) {
        return metadata.weighted_pvp_field
    }

    const strategyConfig =
        metadata?.weighted_pvp_field &&
        weighted.pricing_strategy === "rules_by_weight"
            ? {
                  ...(weighted.strategy_config as RulesByWeightStrategyConfig),
                  fallback_field: metadata.weighted_pvp_field,
              }
            : weighted.strategy_config

    return resolveWeightedPriceStrategyField(
        weighted.pricing_strategy,
        strategyConfig as WeightedPriceStrategyConfig,
        {
            grams,
            fallback_field:
                getWeightedFallbackPvpField(weighted as WeightedAdvancedSettings) ||
                config.weighted_pvp_field,
        }
    ) as WeightedPvpField
}

export function getVariantWeightGrams(variant: MetadataCarrier | null | undefined): number | null {
    const metadataWeight = asPositiveNumber(
        variant?.metadata?.[CONTIFICO_WEIGHT_METADATA_KEY]
    )

    if (metadataWeight != null) {
        return metadataWeight
    }

    return asPositiveNumber(variant?.weight)
}

export function getContificoWeightedPrice(
    product: Pick<ContificoProducto, "pvp1" | "pvp2" | "pvp3" | "pvp4">,
    field: WeightedPvpField
): number | null {
    const selected = asPositiveNumber(product[field])
    if (selected != null) {
        return selected
    }

    return asPositiveNumber(product.pvp1)
}

export function calculateWeightedVariantPrice(
    grams: number,
    pricePerGram: number
): number {
    return roundCurrency(grams * pricePerGram)
}

export function calculateWeightedInvoiceUnitPrice(
    lineUnitPrice: number,
    variantUnits: number,
    gramsPerVariant: number
): number {
    const totalGrams = variantUnits * gramsPerVariant
    if (!totalGrams) {
        return 0
    }

    const lineTotal = roundCurrency(lineUnitPrice * variantUnits)
    return roundDecimal(lineTotal / totalGrams, 6)
}

export function calculateWeightedInvoiceQuantity(
    variantUnits: number,
    gramsPerVariant: number
): number {
    return roundDecimal(variantUnits * gramsPerVariant, 3)
}

export function asPositiveNumber(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) && value > 0 ? value : null
    }

    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number.parseFloat(value)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }

    return null
}

export function roundCurrency(value: number): number {
    return roundDecimal(value, 2)
}

export function roundDecimal(value: number, precision: number): number {
    return Number.parseFloat(value.toFixed(precision))
}
