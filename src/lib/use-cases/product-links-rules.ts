/**
 * Product rules override merge logic.
 * Purely functional — combines, merges, and cleans up ProductRulesOverride objects.
 */

import type { ProductRulesOverride } from "../advanced-settings"
import type { ProductEntityMapMetadata } from "../contifico-metadata"
import { hasKeys } from "../utils"

const PRODUCT_RULE_OVERRIDE_SECTIONS = [
    "pricing",
    "weighted",
    "stock",
    "invoicing",
] as const

export function buildMergedProductRulesOverride(
    current: ProductRulesOverride | null | undefined,
    incoming: ProductRulesOverride | null | undefined,
    weightedPriceSyncOverride: boolean | null | undefined
): ProductRulesOverride | undefined {
    const next =
        incoming === null
            ? undefined
            : mergeProductRulesOverride(current || undefined, incoming || undefined)

    if (weightedPriceSyncOverride === undefined) {
        return next
    }

    const weighted = { ...(next?.weighted || {}) }

    if (weightedPriceSyncOverride === null) {
        delete weighted.allow_weighted_price_sync
    } else {
        weighted.allow_weighted_price_sync = weightedPriceSyncOverride
    }

    return cleanupProductRulesOverride({
        ...(next || {}),
        weighted: hasKeys(weighted) ? weighted : undefined,
    })
}

export function withProductRulesOverride(
    productRulesOverride: ProductRulesOverride | undefined
): Pick<ProductEntityMapMetadata, "product_rules_override"> {
    return {
        product_rules_override: productRulesOverride,
    }
}

// ── Private ──────────────────────────────────────────────

function mergeProductRulesOverride(
    current?: ProductRulesOverride,
    incoming?: ProductRulesOverride
): ProductRulesOverride | undefined {
    if (!current && !incoming) {
        return undefined
    }

    return cleanupProductRulesOverride({
        pricing: mergeProductRulesSection(current?.pricing, incoming?.pricing),
        weighted: mergeProductRulesSection(current?.weighted, incoming?.weighted),
        stock: mergeProductRulesSection(current?.stock, incoming?.stock),
        invoicing: mergeProductRulesSection(current?.invoicing, incoming?.invoicing),
    })
}

function cleanupProductRulesOverride(
    value?: ProductRulesOverride
): ProductRulesOverride | undefined {
    if (!value) {
        return undefined
    }

    const next: ProductRulesOverride = {}
    for (const key of PRODUCT_RULE_OVERRIDE_SECTIONS) {
        const section = value[key]
        if (section && hasKeys(section)) {
            next[key] = section
        }
    }

    return hasKeys(next) ? next : undefined
}

function mergeProductRulesSection<TSection extends object>(
    current?: Partial<TSection> | null,
    incoming?: Partial<TSection> | null
): Partial<TSection> | undefined {
    if (incoming === null) {
        return undefined
    }

    if (!incoming) {
        return current || undefined
    }

    return {
        ...(current || {}),
        ...incoming,
    }
}
