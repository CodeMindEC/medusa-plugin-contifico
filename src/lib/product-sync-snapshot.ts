export type ProductVariantPriceRuleOperator = "gt" | "lt" | "eq" | "lte" | "gte"

export interface ProductVariantPriceRuleWithOperator {
    operator: ProductVariantPriceRuleOperator
    value: number
}

export type ProductVariantPriceSnapshotRules = Record<
    string,
    string | ProductVariantPriceRuleWithOperator[]
>

export interface ProductVariantPriceSnapshotPrice {
    amount: number
    currency_code: string
    min_quantity?: number | null
    max_quantity?: number | null
    rules?: ProductVariantPriceSnapshotRules | null
}

export interface ProductVariantPriceSnapshot {
    variant_id: string
    price_set_id?: string | null
    prices: ProductVariantPriceSnapshotPrice[]
}

export interface ProductSyncSnapshot {
    captured_at: string
    variant_price_sets: ProductVariantPriceSnapshot[]
}

export function normalizeProductSyncSnapshot(
    value: unknown
): ProductSyncSnapshot | undefined {
    if (!isRecord(value)) {
        return undefined
    }

    const capturedAt =
        typeof value.captured_at === "string" && value.captured_at.length > 0
            ? value.captured_at
            : new Date().toISOString()

    const variantPriceSets = Array.isArray(value.variant_price_sets)
        ? value.variant_price_sets
              .map((entry) => normalizeProductVariantPriceSnapshot(entry))
              .filter((entry): entry is ProductVariantPriceSnapshot => !!entry)
        : []

    if (variantPriceSets.length === 0) {
        return undefined
    }

    return {
        captured_at: capturedAt,
        variant_price_sets: variantPriceSets,
    }
}

export function normalizeProductVariantPriceSnapshotPrices(
    value: unknown
): ProductVariantPriceSnapshotPrice[] {
    return Array.isArray(value)
        ? value
              .map((entry) => normalizeProductVariantPriceSnapshotPrice(entry))
              .filter((entry): entry is ProductVariantPriceSnapshotPrice => !!entry)
              .sort(compareSnapshotPrice)
        : []
}

function normalizeProductVariantPriceSnapshot(
    value: unknown
): ProductVariantPriceSnapshot | null {
    if (!isRecord(value) || typeof value.variant_id !== "string" || value.variant_id.length === 0) {
        return null
    }

    return {
        variant_id: value.variant_id,
        price_set_id:
            typeof value.price_set_id === "string" && value.price_set_id.length > 0
                ? value.price_set_id
                : null,
        prices: normalizeProductVariantPriceSnapshotPrices(value.prices),
    }
}

function normalizeProductVariantPriceSnapshotPrice(
    value: unknown
): ProductVariantPriceSnapshotPrice | null {
    if (!isRecord(value)) {
        return null
    }

    const amount = asFiniteNumber(value.amount)
    const currencyCode =
        typeof value.currency_code === "string" && value.currency_code.length > 0
            ? value.currency_code
            : null

    if (amount == null || currencyCode == null) {
        return null
    }

    return {
        amount,
        currency_code: currencyCode,
        min_quantity: asNullableFiniteNumber(value.min_quantity),
        max_quantity: asNullableFiniteNumber(value.max_quantity),
        rules: normalizeProductVariantPriceSnapshotRules(value.rules),
    }
}

function normalizeProductVariantPriceSnapshotRules(
    value: unknown
): ProductVariantPriceSnapshotRules | null {
    if (!isRecord(value)) {
        return null
    }

    const next: ProductVariantPriceSnapshotRules = {}

    for (const [key, ruleValue] of Object.entries(value)) {
        if (typeof ruleValue === "string" && ruleValue.length > 0) {
            next[key] = ruleValue
            continue
        }

        if (!Array.isArray(ruleValue)) {
            continue
        }

        const normalizedRules = ruleValue
            .map((entry) => normalizeProductVariantPriceRuleWithOperator(entry))
            .filter((entry): entry is ProductVariantPriceRuleWithOperator => !!entry)

        if (normalizedRules.length > 0) {
            next[key] = normalizedRules
        }
    }

    return Object.keys(next).length > 0 ? next : null
}

function normalizeProductVariantPriceRuleWithOperator(
    value: unknown
): ProductVariantPriceRuleWithOperator | null {
    if (!isRecord(value)) {
        return null
    }

    const operator = normalizeProductVariantPriceRuleOperator(value.operator)
    const numericValue = asFiniteNumber(value.value)

    if (!operator || numericValue == null) {
        return null
    }

    return {
        operator,
        value: numericValue,
    }
}

function normalizeProductVariantPriceRuleOperator(
    value: unknown
): ProductVariantPriceRuleOperator | null {
    switch (value) {
        case "gt":
        case "lt":
        case "eq":
        case "lte":
        case "gte":
            return value
        default:
            return null
    }
}

function compareSnapshotPrice(
    left: ProductVariantPriceSnapshotPrice,
    right: ProductVariantPriceSnapshotPrice
): number {
    return JSON.stringify({
        currency_code: left.currency_code,
        min_quantity: left.min_quantity ?? null,
        max_quantity: left.max_quantity ?? null,
        amount: left.amount,
        rules: left.rules || null,
    }).localeCompare(
        JSON.stringify({
            currency_code: right.currency_code,
            min_quantity: right.min_quantity ?? null,
            max_quantity: right.max_quantity ?? null,
            amount: right.amount,
            rules: right.rules || null,
        })
    )
}

function asFiniteNumber(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null
    }

    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number.parseFloat(value)
        return Number.isFinite(parsed) ? parsed : null
    }

    return null
}

function asNullableFiniteNumber(value: unknown): number | null {
    if (value == null) {
        return null
    }

    return asFiniteNumber(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}
