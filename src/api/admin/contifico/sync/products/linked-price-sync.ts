import { Modules } from "@medusajs/framework/utils"
import { resolveEffectiveProductRules } from "../../../../../lib/advanced-settings"
import {
    asProductMapMetadata,
    buildProductMapMetadata,
    resolveProductLinkOrigin,
    type ProductEntityMapMetadata,
    type ProductVariantPriceSnapshot,
    type ProductVariantPriceSnapshotPrice,
} from "../../../../../lib/contifico-metadata"
import {
    isWeightedPvpField,
    type VariantMode,
    type WeightedPvpField,
} from "../../../../../lib/contifico-config"
import {
    areSnapshotPricesEqual,
    buildWeightedTargetPrices,
    loadVariantPriceSnapshot,
} from "../../../../../lib/product-price-snapshot"
import { normalize } from "../../../../../lib/similarity"
import {
    CONTIFICO_VARIANT_PVP_FIELD_METADATA_KEY,
    resolveVariantPriceAmount,
    resolveVariantPvpFieldByIndex,
} from "./product-create-builders"
import {
    buildCatalogFingerprint,
    hasCatalogFingerprintChanged,
} from "./product-sync-fingerprint"
import { updateAndCacheProductEntityMap } from "./product-map-cache"
import type {
    LinkedProductRef,
    MedusaCatalogData,
    MedusaProductRecord,
    ProductSyncContext,
    ProductSyncError,
    ProductSyncMetrics,
    ProductVariantRecord,
} from "./types"

interface LinkedVariantPriceUpdate {
    id: string
    price_set_id?: string | null
    prices: ProductVariantPriceSnapshotPrice[]
}

interface LinkedVariantPriceUpdateJob {
    producto: string
    variantLabel: string
    update: LinkedVariantPriceUpdate
}

interface LinkedVariantPricePlan {
    variant: ProductVariantRecord
    field: WeightedPvpField
    amount: number
}

export interface LinkedPriceSyncWarning {
    contifico_id: string
    contifico_nombre: string
    medusa_id: string
    medusa_title: string
    mapping_mode: VariantMode
    message: string
}

export async function syncLinkedProductPrices(
    context: ProductSyncContext,
    medusaCatalog: MedusaCatalogData,
    linkedProducts: LinkedProductRef[],
    metrics: ProductSyncMetrics,
    errors: ProductSyncError[]
): Promise<LinkedPriceSyncWarning[]> {
    const warnings: LinkedPriceSyncWarning[] = []
    const pendingUpdates: LinkedVariantPriceUpdateJob[] = []
    const standardProducts = linkedProducts.filter((item) => {
        const metadata = asProductMapMetadata(item.mappingMetadata)
        return (
            (metadata.mapping_mode_override || context.variantMode) !== "weighted"
        )
    })

    if (standardProducts.length === 0) {
        return warnings
    }

    const variantIds = standardProducts.flatMap((item) =>
        (medusaCatalog.medusaById.get(item.medusaId)?.variants || [])
            .map((variant) => variant.id)
            .filter((id): id is string => !!id)
    )
    const priceSnapshotByVariantId = await loadVariantPriceSnapshot(
        context.services.query,
        variantIds
    )

    context.stream.progress(
        "pricing",
        `Sincronizando precios de ${standardProducts.length} producto(s) vinculados...`,
        68
    )

    for (const item of standardProducts) {
        try {
            const mappingMetadata = asProductMapMetadata(item.mappingMetadata)
            const effectiveRules = resolveEffectiveProductRules(
                context.config.advanced_settings,
                mappingMetadata.product_rules_override || null
            )
            if (!effectiveRules.weighted.allow_weighted_price_sync) {
                continue
            }

            const medusaProduct = medusaCatalog.medusaById.get(item.medusaId)
            if (!medusaProduct) {
                errors.push({
                    producto: item.cp.nombre,
                    error: "El producto vinculado ya no existe en Medusa.",
                })
                metrics.totalErrors++
                continue
            }

            const plan = buildLinkedVariantPricePlan(item.cp.codigo, item.cp, medusaProduct)
            if ("warning" in plan) {
                warnings.push({
                    contifico_id: item.cp.id,
                    contifico_nombre: item.cp.nombre,
                    medusa_id: medusaProduct.id,
                    medusa_title: medusaProduct.title,
                    mapping_mode: mappingMetadata.mapping_mode_override || context.variantMode,
                    message: plan.warning,
                })
                continue
            }

            const currentPriceSnapshot = buildProductSnapshotMap(
                (medusaProduct.variants || [])
                    .map((variant) => variant.id)
                    .filter((id): id is string => !!id),
                priceSnapshotByVariantId
            )
            let nextSnapshot =
                mappingMetadata.sync_snapshot &&
                mappingMetadata.sync_snapshot.variant_price_sets.length > 0
                    ? mappingMetadata.sync_snapshot
                    : null

            for (const variantPlan of plan.plans) {
                const currentVariantPrice = currentPriceSnapshot.get(
                    variantPlan.variant.id
                )
                const targetPrices = buildWeightedTargetPrices(
                    currentVariantPrice?.prices || [],
                    variantPlan.amount,
                    "usd"
                )

                if (
                    areSnapshotPricesEqual(
                        currentVariantPrice?.prices || [],
                        targetPrices
                    )
                ) {
                    continue
                }

                if (
                    !nextSnapshot &&
                    resolveProductLinkOrigin(mappingMetadata) !== "plugin_created"
                ) {
                    nextSnapshot = {
                        captured_at: new Date().toISOString(),
                        variant_price_sets: Array.from(currentPriceSnapshot.values()),
                    }
                }

                pendingUpdates.push({
                    producto: item.cp.nombre,
                    variantLabel:
                        variantPlan.variant.title ||
                        variantPlan.variant.sku ||
                        variantPlan.variant.id,
                    update: {
                        id: variantPlan.variant.id,
                        price_set_id: currentVariantPrice?.price_set_id || null,
                        prices: targetPrices,
                    },
                })
            }

            const catalogFingerprint =
                item.catalogFingerprint || buildCatalogFingerprint(item.cp)
            const nextMetadata = buildLinkedPriceSyncMetadata(
                mappingMetadata,
                item.cp.cantidad_stock,
                catalogFingerprint,
                hasCatalogFingerprintChanged(mappingMetadata, catalogFingerprint),
                nextSnapshot || undefined
            )

            if (hasProductMapMetadataChanged(mappingMetadata, nextMetadata)) {
                await updateAndCacheProductEntityMap(context, medusaCatalog, {
                    medusa_id: item.medusaId,
                    contifico_id: item.cp.id,
                    metadata: nextMetadata,
                })
            }
        } catch (error) {
            errors.push({
                producto: item.cp.nombre,
                error:
                    error instanceof Error
                        ? error.message
                        : "Error sincronizando precio del producto vinculado",
            })
            metrics.totalErrors++
        }
    }

    if (pendingUpdates.length > 0) {
        await applyLinkedPriceUpdates(context, pendingUpdates, metrics, errors)
    }

    return warnings
}

function buildLinkedVariantPricePlan(
    contificoCodigo: string,
    product: Parameters<typeof resolveVariantPriceAmount>[0],
    medusaProduct: MedusaProductRecord
):
    | { plans: LinkedVariantPricePlan[] }
    | {
          warning: string
      } {
    const variants = (medusaProduct.variants || []).filter(
        (variant): variant is ProductVariantRecord & { id: string } => !!variant?.id
    )

    if (variants.length === 0) {
        return {
            warning:
                "No se encontraron variantes de Medusa para sincronizar el precio.",
        }
    }

    if (variants.length > 4 && !hasMetadataDrivenPvpMap(variants)) {
        return {
            warning:
                "Tiene más de 4 variantes y no existe un mapeo PVP guardado; deja el precio manual o reimporta el producto.",
        }
    }

    if (variants.length === 1) {
        const field = resolveVariantPvpField(variants[0], 0) || "pvp1"
        return {
            plans: [
                {
                    variant: variants[0],
                    field,
                    amount: resolveVariantPriceAmount(product, field),
                },
            ],
        }
    }

    const metadataFieldPlan = variants.map((variant, index) => {
        const field = resolveVariantPvpField(variant, index, false)
        return field
            ? {
                  variant,
                  field,
                  amount: resolveVariantPriceAmount(product, field),
              }
            : null
    })
    if (metadataFieldPlan.every((item) => !!item)) {
        return {
            plans: metadataFieldPlan.filter(
                (item): item is LinkedVariantPricePlan => !!item
            ),
        }
    }

    if (!matchesDefaultContificoVariantSkus(variants, contificoCodigo)) {
        return {
            warning:
                "El producto tiene varias variantes y no hay una correspondencia segura de PVP. Alinea los SKU con Contífico o deja el precio manual.",
        }
    }

    return {
        plans: variants.map((variant, index) => {
            const field = resolveVariantPvpFieldByIndex(index)
            return {
                variant,
                field,
                amount: resolveVariantPriceAmount(product, field),
            }
        }),
    }
}

async function applyLinkedPriceUpdates(
    context: ProductSyncContext,
    jobs: LinkedVariantPriceUpdateJob[],
    metrics: ProductSyncMetrics,
    errors: ProductSyncError[]
) {
    for (const batch of chunkArray(jobs, 25)) {
        const results = await Promise.all(
            batch.map((job) =>
                applyLinkedPriceUpdate(context, job).then(
                    () => ({ ok: true as const, job }),
                    (error) => ({ ok: false as const, job, error })
                )
            )
        )

        for (const result of results) {
            if (result.ok) {
                metrics.totalLinkedPriceUpdated =
                    (metrics.totalLinkedPriceUpdated || 0) + 1
                continue
            }

            errors.push({
                producto: result.job.producto,
                error: `Actualizar precio (${result.job.variantLabel}): ${
                    result.error instanceof Error
                        ? result.error.message
                        : "Error interno"
                }`,
            })
            metrics.totalErrors++
        }
    }
}

async function applyLinkedPriceUpdate(
    context: ProductSyncContext,
    job: LinkedVariantPriceUpdateJob
) {
    if (!job.update.price_set_id) {
        const createdPriceSet = await context.services.pricingService.createPriceSets({
            prices: job.update.prices.map((price) => ({
                amount: price.amount,
                currency_code: price.currency_code,
                min_quantity: price.min_quantity ?? undefined,
                max_quantity: price.max_quantity ?? undefined,
                rules: price.rules || undefined,
            })),
        })
        const priceSetId = Array.isArray(createdPriceSet)
            ? createdPriceSet[0]?.id
            : createdPriceSet?.id

        if (!priceSetId) {
            throw new Error("No se pudo crear el price_set para la variante")
        }

        await context.services.link.create({
            [Modules.PRODUCT]: { variant_id: job.update.id },
            [Modules.PRICING]: { price_set_id: priceSetId },
        })
        return
    }

    await context.services.pricingService.updatePriceSets(job.update.price_set_id, {
        prices: job.update.prices.map((price) => ({
            amount: price.amount,
            currency_code: price.currency_code,
            min_quantity: price.min_quantity ?? undefined,
            max_quantity: price.max_quantity ?? undefined,
            rules: price.rules || undefined,
        })),
    })
}

function buildLinkedPriceSyncMetadata(
    metadata: ProductEntityMapMetadata,
    cantidadStock: string | number | null | undefined,
    catalogFingerprint: string,
    refreshSyncTimestamp: boolean,
    nextSnapshot?: ProductEntityMapMetadata["sync_snapshot"]
) {
    return buildProductMapMetadata({
        ...metadata,
        contifico_stock_grams: Number.parseFloat(`${cantidadStock ?? "0"}`) || 0,
        sync_snapshot: nextSnapshot,
        sync_state: {
            ...metadata.sync_state,
            catalog_fingerprint: catalogFingerprint,
            weighted_config_fingerprint:
                metadata.sync_state?.weighted_config_fingerprint || null,
            last_catalog_sync_at:
                refreshSyncTimestamp || !metadata.sync_state?.last_catalog_sync_at
                    ? new Date().toISOString()
                    : metadata.sync_state.last_catalog_sync_at,
            cleanup_state:
                metadata.sync_state?.cleanup_state === "failed"
                    ? "failed"
                    : null,
            cleanup_last_error:
                metadata.sync_state?.cleanup_state === "failed"
                    ? metadata.sync_state.cleanup_last_error || null
                    : null,
        },
    })
}

function hasMetadataDrivenPvpMap(variants: ProductVariantRecord[]) {
    return variants.every((variant, index) =>
        !!resolveVariantPvpField(variant, index, false)
    )
}

function resolveVariantPvpField(
    variant: ProductVariantRecord,
    index: number,
    fallbackToIndex = true
): WeightedPvpField | null {
    const metadataField = variant.metadata?.[
        CONTIFICO_VARIANT_PVP_FIELD_METADATA_KEY
    ]
    if (
        typeof metadataField === "string" &&
        isWeightedPvpField(metadataField)
    ) {
        return metadataField
    }

    return fallbackToIndex ? resolveVariantPvpFieldByIndex(index) : null
}

function matchesDefaultContificoVariantSkus(
    variants: ProductVariantRecord[],
    contificoCodigo: string
) {
    const expectedSkus = variants.map((_, index) =>
        variants.length === 1 ? contificoCodigo : `${contificoCodigo}-${index + 1}`
    )

    return variants.every((variant, index) => {
        if (!variant.sku) {
            return false
        }

        return normalize(variant.sku) === normalize(expectedSkus[index])
    })
}

function buildProductSnapshotMap(
    variantIds: string[],
    snapshotByVariantId: Map<string, ProductVariantPriceSnapshot>
): Map<string, ProductVariantPriceSnapshot> {
    return new Map(
        variantIds
            .map((variantId) => {
                const snapshot = snapshotByVariantId.get(variantId)
                return snapshot ? [variantId, snapshot] : null
            })
            .filter(
                (
                    entry
                ): entry is [string, ProductVariantPriceSnapshot] => !!entry
            )
    )
}

function hasProductMapMetadataChanged(
    currentMetadata: unknown,
    nextMetadata: ProductEntityMapMetadata | null
) {
    return (
        JSON.stringify(buildProductMapMetadata(asProductMapMetadata(currentMetadata))) !==
        JSON.stringify(nextMetadata)
    )
}

function chunkArray<TItem>(items: TItem[], chunkSize: number): TItem[][] {
    const chunks: TItem[][] = []
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize))
    }
    return chunks
}
