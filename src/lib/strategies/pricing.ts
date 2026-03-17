import type {
    PricingAdvancedSettings,
    StrategyDecision,
} from "../advanced-settings"
import type { WeightedPvpField } from "../contifico-config"
import { roundCurrency } from "../contifico-weighted"
import type { ContificoProducto } from "../types"

export interface PricingResult {
    amount: number
    decisions: Array<StrategyDecision<unknown>>
}

export function resolveWeightedPricePerGram(
    product: Pick<ContificoProducto, "pvp1" | "pvp2" | "pvp3" | "pvp4">,
    field: WeightedPvpField,
    pricing: PricingAdvancedSettings
): PricingResult | null {
    const base = parsePvp(product[field]) ?? parsePvp(product.pvp1)
    if (base == null) {
        return null
    }

    let amount = base
    const decisions: Array<StrategyDecision<unknown>> = [{
        strategy: "pricing:pvp",
        value: field,
        reason: `Campo base ${field}`,
    }]

    if (pricing.markup_percent) {
        amount = amount * (1 + pricing.markup_percent / 100)
        decisions.push({
            strategy: "pricing:markup",
            value: pricing.markup_percent,
            reason: "Markup aplicado",
        })
    }

    amount = applyRounding(amount, pricing.rounding_mode)
    decisions.push({
        strategy: "pricing:rounding",
        value: pricing.rounding_mode,
        reason: "Redondeo aplicado",
    })

    if (pricing.minimum_price != null && amount < pricing.minimum_price) {
        amount = pricing.minimum_price
        decisions.push({
            strategy: "pricing:minimum_price",
            value: pricing.minimum_price,
            reason: "Precio mínimo aplicado",
        })
    }

    return {
        amount,
        decisions,
    }
}

export function applyRounding(value: number, mode: PricingAdvancedSettings["rounding_mode"]): number {
    switch (mode) {
        case "commercial_05":
            return roundCurrency(Math.round(value * 20) / 20)
        case "commercial_10":
            return roundCurrency(Math.round(value * 10) / 10)
        case "none":
            return value
        default:
            // Preserve the raw precision returned by Contifico unless the
            // strategy explicitly requests commercial rounding.
            return value
    }
}

function parsePvp(value: string | null | undefined): number | null {
    if (!value) {
        return null
    }
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
}
