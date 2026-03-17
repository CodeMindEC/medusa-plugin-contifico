import { buildProductMapMetadata } from "../../../../../lib/contifico-metadata"
import { normalize } from "../../../../../lib/similarity"
import {
    resolveWeightedPresentationProfile,
} from "../../../../../lib/weighted-presentation-profiles"
import { buildCatalogFingerprint } from "./product-sync-fingerprint"
import { buildWeightedConfigFingerprint } from "./product-sync-fingerprint"
import { createAndCacheProductEntityMap } from "./product-map-cache"
import type {
    CreatedMedusaProduct,
    MedusaCatalogData,
    ProductCatalogData,
    ProductClassificationResult,
    ProductSyncContext,
    ProductSyncError,
    ProductSyncMetrics,
} from "./types"
import {
    attachVariantResources,
    buildProductInput,
} from "./product-create-builders"

const BATCH_SIZE = 20

export async function createProductsFromContifico(
    context: ProductSyncContext,
    productCatalog: ProductCatalogData,
    medusaCatalog: MedusaCatalogData,
    classification: ProductClassificationResult,
    metrics: ProductSyncMetrics,
    errors: ProductSyncError[]
): Promise<void> {
    const syncTimestamp = new Date().toISOString()
    const weightedConfigFingerprint =
        context.variantMode === "weighted"
            ? buildWeightedConfigFingerprint(context.config.advanced_settings.weighted)
            : null

    if (context.variantMode === "weighted") {
        const creatable = classification.toCreate
            .map((product) => ({
                product,
                resolution: resolveWeightedPresentationProfile(
                    product,
                    {
                        creation_mode: context.config.advanced_settings.weighted.creation_mode,
                        default_profile_id: context.config.advanced_settings.weighted.default_profile_id,
                        creation_profiles: context.config.advanced_settings.weighted.creation_profiles,
                    }
                ),
            }))
        const weightedToCreate = creatable
            .filter((item) => !!item.resolution.profile)
            .map((item) => item.product)
        const weightedDeferred = creatable.filter((item) => !item.resolution.profile)

        metrics.totalWeightedDeferred += weightedDeferred.length
        classification.toCreate = weightedToCreate

        if (weightedDeferred.length > 0) {
            context.stream.progress(
                "weighted",
                `${weightedDeferred.length} producto(s) sin perfil weighted aplicable requieren revisión manual.`,
                60
            )
        }
    }

    if (classification.toCreate.length === 0) {
        return
    }

    const usedHandles = new Set(
        medusaCatalog.medusaProducts
            .map((product) => product.handle)
            .filter((handle): handle is string => !!handle)
    )

    for (let index = 0; index < classification.toCreate.length; index += BATCH_SIZE) {
        const batchEnd = Math.min(index + BATCH_SIZE, classification.toCreate.length)
        const percent = 42 + Math.round(38 * (index / classification.toCreate.length))
        context.stream.progress(
            "create",
            `Creando productos ${index + 1}-${batchEnd} de ${classification.toCreate.length} (descargando imagenes)...`,
            percent
        )

        const batch = classification.toCreate.slice(index, index + BATCH_SIZE)
        const builtProducts = batch.map((product) =>
            buildProductInput(context, productCatalog.varianteMap, product, usedHandles)
        )
        const productInputs = builtProducts.map((item) => item.input)
        const resourcePlans = builtProducts.map((item) => item.resources)

        try {
            const createdProductsRaw = await context.services.productService.createProducts(
                productInputs
            )
            const createdProducts = Array.isArray(createdProductsRaw)
                ? createdProductsRaw
                : [createdProductsRaw]

            await attachVariantResources(
                context,
                batch,
                createdProducts as CreatedMedusaProduct[],
                medusaCatalog.inventoryItemsBySku,
                resourcePlans
            )

            for (let itemIndex = 0; itemIndex < createdProducts.length; itemIndex++) {
                const created = createdProducts[itemIndex] as CreatedMedusaProduct
                const source = batch[itemIndex]
                const metadata = buildCreatedProductMapMetadata({
                    source,
                    profile_id: resourcePlans[itemIndex]?.profile_id || null,
                    catalogFingerprint: buildCatalogFingerprint(source),
                    weightedConfigFingerprint,
                    syncTimestamp,
                })
                const createdMap = await createAndCacheProductEntityMap(
                    context,
                    medusaCatalog,
                    {
                        medusa_id: created.id,
                        contifico_id: source.id,
                        metadata,
                    }
                )

                classification.linkedProducts.push({
                    cp: source,
                    medusaId: created.id,
                    mappingMetadata: createdMap?.metadata || metadata,
                    catalogFingerprint: buildCatalogFingerprint(source),
                })
                medusaCatalog.medusaProducts.push(created)
                medusaCatalog.medusaById.set(created.id, created)
                for (const variant of created.variants || []) {
                    if (variant.sku) {
                        medusaCatalog.medusaBySku.set(
                            normalize(variant.sku),
                            created
                        )
                    }
                }
                metrics.totalCreated++
                metrics.totalVariants += created.variants?.length || 1
                if (source.imagen?.startsWith("http")) {
                    metrics.totalImages++
                }
            }
        } catch (error) {
            for (const product of batch) {
                errors.push({
                    producto: product.nombre,
                    error: `Crear: ${error instanceof Error ? error.message : "Error creando producto"}`,
                })
                metrics.totalErrors++
            }
        }
    }
}

export function buildCreatedProductMapMetadata(args: {
    source: Pick<
        ProductCatalogData["activeProducts"][number],
        "codigo" | "nombre" | "imagen" | "cantidad_stock"
    >
    profile_id?: string | null
    catalogFingerprint: string
    weightedConfigFingerprint?: string | null
    syncTimestamp: string
}) {
    return buildProductMapMetadata({
        codigo: args.source.codigo,
        nombre: args.source.nombre,
        imagen: args.source.imagen || null,
        created: true,
        link_origin: "plugin_created",
        contifico_stock_grams: Number.parseFloat(`${args.source.cantidad_stock ?? "0"}`) || 0,
        weighted_creation_profile_id: args.profile_id || undefined,
        sync_state: {
            catalog_fingerprint: args.catalogFingerprint,
            weighted_config_fingerprint: args.weightedConfigFingerprint || null,
            last_catalog_sync_at: args.syncTimestamp,
            cleanup_state: null,
            cleanup_last_error: null,
        },
    })
}
