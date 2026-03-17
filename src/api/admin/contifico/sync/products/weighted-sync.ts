import { Modules } from "@medusajs/framework/utils"
import { resolveEffectiveProductRules } from "../../../../../lib/advanced-settings"
import {
    asProductMapMetadata,
    buildProductMapMetadata,
    resolveProductLinkOrigin,
    type ProductVariantPriceSnapshot,
    type ProductEntityMapMetadata,
    type ProductVariantPriceSnapshotPrice,
} from "../../../../../lib/contifico-metadata"
import {
    calculateWeightedVariantPrice,
    getContificoWeightedPrice,
    getEffectiveMappingMode,
    getVariantWeightGrams,
    resolveWeightedPvpField,
} from "../../../../../lib/contifico-weighted"
import {
    areSnapshotPricesEqual,
    buildWeightedTargetPrices,
    loadVariantPriceSnapshot,
} from "../../../../../lib/product-price-snapshot"
import {
    buildCatalogFingerprint,
    buildWeightedConfigFingerprint,
    hasCatalogFingerprintChanged,
    hasWeightedConfigFingerprintChanged,
} from "./product-sync-fingerprint"
import { updateAndCacheProductEntityMap } from "./product-map-cache"
import type {
    LinkedProductRef,
    MedusaCatalogData,
    ProductSyncContext,
    ProductSyncError,
    ProductSyncMetrics,
    WeightedProductWarning,
} from "./types"

interface WeightedVariantPriceUpdate {
    id: string
    price_set_id?: string | null
    prices: ProductVariantPriceSnapshotPrice[]
}

interface WeightedVariantPriceUpdateJob {
    producto: string
    variantLabel: string
    update: WeightedVariantPriceUpdate
}

export async function syncWeightedLinkedProductPrices(
    context: ProductSyncContext,
    medusaCatalog: MedusaCatalogData,
    linkedProducts: LinkedProductRef[],
    metrics: ProductSyncMetrics,
    errors: ProductSyncError[]
): Promise<WeightedProductWarning[]> {
    const warnings: WeightedProductWarning[] = []
    const pendingUpdates: WeightedVariantPriceUpdateJob[] = []
    const weightedConfigFingerprint = buildWeightedConfigFingerprint(
        context.config.advanced_settings.weighted
    )
    const weightedProducts = linkedProducts.filter((item) =>
        getEffectiveMappingMode(context.config, item.mappingMetadata) === "weighted"
    )

    if (weightedProducts.length === 0) {
        return warnings
    }

    const weightedVariantIds = weightedProducts.flatMap((item) =>
        (medusaCatalog.medusaById.get(item.medusaId)?.variants || [])
            .map((variant) => variant.id)
            .filter((id): id is string => !!id)
    )
    const priceSnapshotByVariantId = await loadVariantPriceSnapshot(
        context.services.query,
        weightedVariantIds
    )

    context.stream.progress(
        "weighted",
        `Actualizando precios por peso de ${weightedProducts.length} producto(s)...`,
        72
    )

    for (const item of weightedProducts) {
        try {
            const mappingMetadata = asProductMapMetadata(item.mappingMetadata)
            const catalogFingerprint =
                item.catalogFingerprint || buildCatalogFingerprint(item.cp)
            const effectiveRules = resolveEffectiveProductRules(
                context.config.advanced_settings,
                mappingMetadata.product_rules_override || null
            )
            const catalogChanged = hasCatalogFingerprintChanged(
                mappingMetadata,
                catalogFingerprint
            )
            const weightedConfigChanged = hasWeightedConfigFingerprintChanged(
                mappingMetadata,
                weightedConfigFingerprint
            )
            const medusaProduct = medusaCatalog.medusaById.get(item.medusaId)
            if (!medusaProduct) {
                errors.push({
                    producto: item.cp.nombre,
                    error: "Modo weighted: el producto vinculado ya no existe en Medusa.",
                })
                metrics.totalErrors++
                continue
            }

            if (!effectiveRules.weighted.allow_weighted_price_sync) {
                if (catalogChanged || weightedConfigChanged) {
                    await persistWeightedSyncMetadata(
                        context,
                        medusaCatalog,
                        item,
                        mappingMetadata,
                        catalogFingerprint,
                        weightedConfigFingerprint
                    )
                }
                if (catalogChanged || weightedConfigChanged) {
                    warnings.push({
                        contifico_id: item.cp.id,
                        contifico_nombre: item.cp.nombre,
                        medusa_id: medusaProduct.id,
                        medusa_title: medusaProduct.title,
                        message: "La sincronizacion de precio por peso está desactivada para este producto; se mantuvo el precio manual de Medusa.",
                    })
                    metrics.totalWeightedDeferred++
                }
                continue
            }

            const variants = medusaProduct.variants || []
            const updates: WeightedVariantPriceUpdateJob[] = []
            const missingVariants: string[] = []
            const currentPriceSnapshot = buildProductSnapshotMap(
                variants.map((variant) => variant.id),
                priceSnapshotByVariantId
            )
            let nextSnapshot =
                mappingMetadata.sync_snapshot &&
                mappingMetadata.sync_snapshot.variant_price_sets.length > 0
                    ? mappingMetadata.sync_snapshot
                    : null

            for (const variant of variants) {
                const grams = getVariantWeightGrams(variant)
                if (grams == null) {
                    missingVariants.push(variant.title || variant.sku || variant.id)
                    continue
                }

                const weightedPvpField = resolveWeightedPvpField(
                    context.config,
                    effectiveRules.weighted,
                    grams,
                    mappingMetadata
                )
                const pricePerGram = getContificoWeightedPrice(
                    item.cp,
                    weightedPvpField
                )
                if (pricePerGram == null) {
                    missingVariants.push(variant.title || variant.sku || variant.id)
                    continue
                }

                const currentVariantPrice = currentPriceSnapshot.get(variant.id)
                const targetPrices = buildWeightedTargetPrices(
                    currentVariantPrice?.prices || [],
                    calculateWeightedVariantPrice(grams, pricePerGram),
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
                        variant_price_sets: Array.from(
                            currentPriceSnapshot.values()
                        ),
                    }
                }

                updates.push({
                    producto: item.cp.nombre,
                    variantLabel: variant.title || variant.sku || variant.id,
                    update: {
                        id: variant.id,
                        price_set_id: currentVariantPrice?.price_set_id || null,
                        prices: targetPrices,
                    },
                })
            }

            pendingUpdates.push(...updates)

            if (missingVariants.length > 0) {
                warnings.push({
                    contifico_id: item.cp.id,
                    contifico_nombre: item.cp.nombre,
                    medusa_id: medusaProduct.id,
                    medusa_title: medusaProduct.title,
                    message: "Hay variantes sin peso usable o sin PVP resoluble; sus precios no se actualizaron.",
                    missing_variants: missingVariants,
                })
            }

            const mapRecord = medusaCatalog.mapByContifico.get(item.cp.id)
            const nextMetadata = buildWeightedSyncMetadata(
                asProductMapMetadata(mapRecord?.metadata),
                item.cp.cantidad_stock,
                catalogFingerprint,
                weightedConfigFingerprint,
                catalogChanged || weightedConfigChanged,
                nextSnapshot || undefined
            )

            if (
                !mapRecord ||
                hasProductMapMetadataChanged(mapRecord.metadata, nextMetadata)
            ) {
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
                        : "Error sincronizando precio weighted",
            })
            metrics.totalErrors++
        }
    }

    if (pendingUpdates.length > 0) {
        await applyWeightedPriceUpdates(
            context,
            pendingUpdates,
            metrics,
            errors
        )
    }

    return warnings
}

async function applyWeightedPriceUpdates(
    context: ProductSyncContext,
    jobs: WeightedVariantPriceUpdateJob[],
    metrics: ProductSyncMetrics,
    errors: ProductSyncError[]
) {
    for (const batch of chunkArray(jobs, 25)) {
        const results = await Promise.all(
            batch.map((job) =>
                applyWeightedPriceUpdate(context, job).then(
                    () => ({ ok: true as const, job }),
                    (error) => ({ ok: false as const, job, error })
                )
            )
        )

        for (const result of results) {
            if (result.ok) {
                metrics.totalWeightedPriceUpdated++
                continue
            }

            errors.push({
                producto: result.job.producto,
                error: `Actualizar precio weighted (${result.job.variantLabel}): ${
                    result.error instanceof Error
                        ? result.error.message
                        : "Error interno"
                }`,
            })
            metrics.totalErrors++
        }
    }
}

async function applyWeightedPriceUpdate(
    context: ProductSyncContext,
    job: WeightedVariantPriceUpdateJob
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

function chunkArray<TItem>(items: TItem[], chunkSize: number): TItem[][] {
    const chunks: TItem[][] = []
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize))
    }
    return chunks
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

function buildWeightedSyncMetadata(
    metadata: ProductEntityMapMetadata,
    cantidadStock: string | number | null | undefined,
    catalogFingerprint: string,
    weightedConfigFingerprint: string,
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
            weighted_config_fingerprint: weightedConfigFingerprint,
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

async function persistWeightedSyncMetadata(
    context: ProductSyncContext,
    medusaCatalog: MedusaCatalogData,
    item: LinkedProductRef,
    metadata: ProductEntityMapMetadata,
    catalogFingerprint: string,
    weightedConfigFingerprint: string
) {
    const nextMetadata = buildWeightedSyncMetadata(
        metadata,
        item.cp.cantidad_stock,
        catalogFingerprint,
        weightedConfigFingerprint,
        true,
        metadata.sync_snapshot
    )

    if (!hasProductMapMetadataChanged(metadata, nextMetadata)) {
        return
    }

    await updateAndCacheProductEntityMap(context, medusaCatalog, {
        medusa_id: item.medusaId,
        contifico_id: item.cp.id,
        metadata: nextMetadata,
    })
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
