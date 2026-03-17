import type { IProductModuleService, IPricingModuleService } from "@medusajs/framework/types"
import type {
    ProductSyncSnapshot,
    ProductVariantPriceSnapshot,
    ProductVariantPriceSnapshotPrice,
} from "./contifico-metadata"
import { normalizeProductVariantPriceSnapshotPrices } from "./product-sync-snapshot"

type UpdatePriceSetPayload = Parameters<IPricingModuleService["updatePriceSets"]>[1]
type UpdatePriceSetPrice = NonNullable<UpdatePriceSetPayload["prices"]>[number]
const PRICE_RESTORE_BATCH_SIZE = 20

interface QueryGraphService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

interface VariantPriceGraphRecord {
    id: string
    price_set?: {
        id?: string | null
        prices?: unknown[]
    } | null
}

interface ProductVariantCarrier {
    id: string
    variants?: Array<{ id?: string | null }> | null
}

export async function captureProductPriceSnapshot(args: {
    productService: Pick<IProductModuleService, "listProducts">
    query: QueryGraphService
    productIds: string[]
}): Promise<Map<string, ProductSyncSnapshot>> {
    const products = await args.productService.listProducts(
        { id: args.productIds },
        { relations: ["variants"], take: args.productIds.length + 20 }
    )

    const productVariants = new Map<string, string[]>()
    const variantIds: string[] = []

    for (const product of products as ProductVariantCarrier[]) {
        const ids = (product.variants || [])
            .map((variant) => variant.id)
            .filter((id): id is string => !!id)

        productVariants.set(product.id, ids)
        variantIds.push(...ids)
    }

    const snapshotByVariant = await loadVariantPriceSnapshot(args.query, variantIds)
    const result = new Map<string, ProductSyncSnapshot>()

    for (const [productId, ids] of productVariants.entries()) {
        result.set(productId, {
            captured_at: new Date().toISOString(),
            variant_price_sets: ids
                .map((variantId) => snapshotByVariant.get(variantId))
                .filter((entry): entry is ProductVariantPriceSnapshot => !!entry),
        })
    }

    return result
}

export async function loadVariantPriceSnapshot(
    query: QueryGraphService,
    variantIds: string[]
): Promise<Map<string, ProductVariantPriceSnapshot>> {
    if (variantIds.length === 0) {
        return new Map()
    }

    const { data } = await query.graph<VariantPriceGraphRecord>({
        entity: "variant",
        fields: ["id", "price_set.id", "price_set.prices.*"],
        filters: { id: variantIds },
    })

    return new Map(
        (data || []).map((variant) => [
            variant.id,
            {
                variant_id: variant.id,
                price_set_id: variant.price_set?.id || null,
                prices: normalizeProductVariantPriceSnapshotPrices(variant.price_set?.prices),
            },
        ])
    )
}

export function buildWeightedTargetPrices(
    currentPrices: ProductVariantPriceSnapshotPrice[],
    amount: number,
    currencyCode = "usd"
): ProductVariantPriceSnapshotPrice[] {
    const normalizedCurrent = normalizeProductVariantPriceSnapshotPrices(currentPrices)
    const nextPrices = [...normalizedCurrent]
    const simplePriceIndex = nextPrices.findIndex((price) =>
        isSimpleCurrencyPrice(price, currencyCode)
    )

    const targetPrice: ProductVariantPriceSnapshotPrice = {
        amount,
        currency_code: currencyCode,
    }

    if (simplePriceIndex >= 0) {
        nextPrices[simplePriceIndex] = targetPrice
    } else {
        nextPrices.push(targetPrice)
    }

    return normalizeProductVariantPriceSnapshotPrices(nextPrices)
}

export function areSnapshotPricesEqual(
    left: ProductVariantPriceSnapshotPrice[],
    right: ProductVariantPriceSnapshotPrice[]
): boolean {
    return (
        JSON.stringify(normalizeProductVariantPriceSnapshotPrices(left)) ===
        JSON.stringify(normalizeProductVariantPriceSnapshotPrices(right))
    )
}

export async function restoreProductPriceSnapshot(args: {
    pricingService: Pick<IPricingModuleService, "updatePriceSets">
    snapshot: ProductSyncSnapshot | null | undefined
}) {
    const entries = (args.snapshot?.variant_price_sets || []).filter(
        isRestorableVariantPriceSnapshot
    )

    let restored = 0
    const errors: Array<{ variant_id: string; error: string }> = []

    for (const batch of chunkArray(entries, PRICE_RESTORE_BATCH_SIZE)) {
        const results = await Promise.all(
            batch.map(async (entry) => {
                try {
                    await args.pricingService.updatePriceSets(entry.price_set_id, {
                        prices: normalizeProductVariantPriceSnapshotPrices(
                            entry.prices
                        ).map(toPriceSetUpdatePrice),
                    })
                    return { ok: true as const, entry }
                } catch (error) {
                    return {
                        ok: false as const,
                        entry,
                        error:
                            error instanceof Error
                                ? error.message
                                : "Error restaurando precio",
                    }
                }
            })
        )

        for (const result of results) {
            if (result.ok) {
                restored++
                continue
            }

            errors.push({
                variant_id: result.entry.variant_id,
                error: result.error,
            })
        }
    }

    return {
        restored,
        errors,
    }
}

function chunkArray<TItem>(items: TItem[], chunkSize: number): TItem[][] {
    const chunks: TItem[][] = []
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize))
    }
    return chunks
}

export function hasRestorablePriceSnapshot(
    snapshot: ProductSyncSnapshot | null | undefined
): boolean {
    return !!snapshot?.variant_price_sets?.some(isRestorableVariantPriceSnapshot)
}

function isRestorableVariantPriceSnapshot(
    entry: ProductVariantPriceSnapshot
): entry is ProductVariantPriceSnapshot & { price_set_id: string } {
    return typeof entry.price_set_id === "string" && entry.price_set_id.length > 0 && entry.prices.length > 0
}

function toPriceSetUpdatePrice(price: ProductVariantPriceSnapshotPrice) {
    return {
        amount: price.amount,
        currency_code: price.currency_code,
        min_quantity: price.min_quantity ?? undefined,
        max_quantity: price.max_quantity ?? undefined,
        rules: price.rules || undefined,
    } satisfies UpdatePriceSetPrice
}

function isSimpleCurrencyPrice(
    price: ProductVariantPriceSnapshotPrice,
    currencyCode: string
): boolean {
    return (
        price.currency_code.toLowerCase() === currencyCode.toLowerCase() &&
        (price.min_quantity == null || price.min_quantity === 0) &&
        price.max_quantity == null &&
        (!price.rules || Object.keys(price.rules).length === 0)
    )
}
