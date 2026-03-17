import {
    asProductMapMetadata,
    buildProductMapMetadata,
} from "../../../../../lib/contifico-metadata"
import { getMatchCandidatesFromIndex } from "./medusa-match-index"
import { buildCatalogFingerprint } from "./product-sync-fingerprint"
import { createAndCacheProductEntityMap } from "./product-map-cache"
import { resolveMatch } from "../../../../../lib/strategies/matching"
import type {
    ContificoEntityMapRecord,
    MedusaCatalogData,
    ProductCatalogData,
    ProductClassificationResult,
    ProductSyncContext,
    ProductSyncError,
    ProductSyncMetrics,
} from "./types"

export async function classifyProducts(
    context: ProductSyncContext,
    productCatalog: ProductCatalogData,
    medusaCatalog: MedusaCatalogData,
    metrics: ProductSyncMetrics,
    errors: ProductSyncError[]
): Promise<ProductClassificationResult> {
    context.stream.progress(
        "classify",
        `Clasificando ${productCatalog.activeProducts.length} productos...`,
        35
    )

    const linkedProducts: ProductClassificationResult["linkedProducts"] = []
    const toCreate: ProductClassificationResult["toCreate"] = []

    for (const contificoProduct of productCatalog.activeProducts) {
        try {
            const catalogFingerprint = buildCatalogFingerprint(contificoProduct)
            let medusaId: string | null =
                medusaCatalog.mapByContifico.get(contificoProduct.id)?.medusa_id || null

            if (!medusaId && context.config.advanced_settings.matching.allow_auto_link) {
                const candidates = getMatchCandidatesFromIndex(
                    medusaCatalog.matchIndex,
                    {
                        codigo: contificoProduct.codigo,
                        nombre: contificoProduct.nombre,
                        barcode: contificoProduct.codigo_barra || null,
                    }
                )

                const match = resolveMatch({
                    contifico_id: contificoProduct.id,
                    contifico_codigo: contificoProduct.codigo,
                    contifico_nombre: contificoProduct.nombre,
                    contifico_barcode: contificoProduct.codigo_barra || null,
                    candidates,
                    threshold: context.config.advanced_settings.matching.similarity_threshold,
                    settings: context.config.advanced_settings.matching,
                })

                if (match.candidate) {
                    medusaId = match.candidate.id
                    await createAutoLink(
                        context,
                        medusaCatalog,
                        contificoProduct,
                        medusaId,
                        {
                            codigo: contificoProduct.codigo,
                            nombre: contificoProduct.nombre,
                            imagen: contificoProduct.imagen || null,
                            auto_linked: true,
                            match_type:
                                match.match_type === "barcode"
                                    ? "barcode"
                                    : match.match_type === "exact_sku"
                                        ? "sku"
                                        : "name",
                            similarity: match.similarity || undefined,
                            link_origin: "manual",
                        }
                    )
                    metrics.totalAutoLinked++
                }
            }

            if (medusaId) {
                linkedProducts.push({
                    cp: contificoProduct,
                    medusaId,
                    mappingMetadata: asProductMapMetadata(
                        medusaCatalog.mapByContifico.get(contificoProduct.id)?.metadata
                    ),
                    catalogFingerprint,
                })
            } else {
                toCreate.push(contificoProduct)
            }
        } catch (error) {
            errors.push({
                producto: contificoProduct.nombre || contificoProduct.codigo,
                error: error instanceof Error ? error.message : "Error clasificando producto",
            })
            metrics.totalErrors++
        }
    }

    context.stream.progress(
        "classify",
        `${toCreate.length} por crear, ${linkedProducts.length} vinculados`,
        40
    )

    return { linkedProducts, toCreate }
}

async function createAutoLink(
    context: ProductSyncContext,
    medusaCatalog: MedusaCatalogData,
    contificoProduct: ProductCatalogData["activeProducts"][number],
    medusaId: string,
    metadata: ContificoEntityMapRecord["metadata"]
) {
    await createAndCacheProductEntityMap(context, medusaCatalog, {
        medusa_id: medusaId,
        contifico_id: contificoProduct.id,
        metadata: buildProductMapMetadata(metadata || {}),
    })
}
