import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { resolveEffectiveProductRules } from "../advanced-settings"
import {
    asProductMapMetadata,
    buildProductMapMetadata,
    needsProductMapMetadataMigration,
    resolveProductLinkOrigin,
} from "../contifico-metadata"
import {
    getEffectiveMappingMode,
    getEffectiveWeightedPvpField,
    getVariantWeightGrams,
} from "../contifico-weighted"
import {
    getPrimaryVariantSku,
    type MedusaProductLike,
} from "../medusa-product"
import {
    createCorrelationId,
    getErrorMessage,
    logContificoEvent,
} from "../observability"
import { getContificoConfig, getContificoService } from "../../api/admin/contifico/shared"

interface LinkedProductVariantLike {
    id: string
    title?: string | null
    sku?: string | null
    weight?: number | null
    metadata?: Record<string, unknown> | null
}

interface LinkedMedusaProductLike extends MedusaProductLike {
    variants?: LinkedProductVariantLike[] | null
}

export async function runListLinkedProducts(req: MedusaRequest, res: MedusaResponse) {
    const correlationId = createCorrelationId("contifico_linked_products")

    try {
        const contificoService = getContificoService(req.scope)
        const productService: IProductModuleService = req.scope.resolve(Modules.PRODUCT)
        const result = await listLinkedProducts(contificoService, productService, correlationId)
        res.json(result)
    } catch (error) {
        res.status(500).json({
            error: `Error obteniendo productos: ${getErrorMessage(error, "Error interno")}`,
        })
    }
}

export async function listLinkedProducts(
    contificoService: ReturnType<typeof getContificoService>,
    productService: IProductModuleService,
    correlationId: string
) {
    const { normalized: config } = await getContificoConfig(contificoService)
    const [entityMaps] = await contificoService.listAndCountContificoEntityMaps(
        { entity_type: "product" },
        { take: 5000 }
    )
    const activeEntityMaps = entityMaps.filter(
        (item) => asProductMapMetadata(item.metadata).sync_state?.cleanup_state !== "pending"
    )
    const medusaProducts = await productService.listProducts(
        {},
        { take: 5000, relations: ["variants"] }
    )
    const medusaById = new Map(
        medusaProducts.map((product) => [product.id, product as MedusaProductLike])
    )

    const mapsNeedingMigration = activeEntityMaps.filter((item) =>
        needsProductMapMetadataMigration(item.metadata)
    )
    await Promise.all(
        mapsNeedingMigration.map((item) =>
            contificoService.updateContificoEntityMaps({
                id: item.id,
                metadata: buildProductMapMetadata(asProductMapMetadata(item.metadata)),
            })
        )
    )

    const linked = activeEntityMaps
        .map((map) => buildLinkedProductEntry(map, medusaById, config))
        .sort((a, b) => a.contifico_nombre.localeCompare(b.contifico_nombre))

    const all_medusa = medusaProducts
        .map((product) => ({
            medusa_id: product.id,
            medusa_title: product.title,
            medusa_sku: getPrimaryVariantSku(product as MedusaProductLike),
        }))
        .sort((a, b) => a.medusa_title.localeCompare(b.medusa_title))

    logContificoEvent("info", "Linked products listed", {
        correlation_id: correlationId,
        operation: "products.linked.list",
        linked: linked.length,
        medusa_total: medusaProducts.length,
        migrated_metadata: mapsNeedingMigration.length,
    })

    return {
        linked,
        all_medusa,
        defaults: {
            variant_mode: config?.variant_mode || "auto",
            weighted_pvp_field: config?.weighted_pvp_field || "pvp1",
            weighted_price_sync_enabled:
                config?.advanced_settings.weighted.allow_weighted_price_sync ?? false,
            weighted_strategy:
                config?.advanced_settings.weighted.pricing_strategy || "fixed_pvp_field",
        },
        stats: {
            total_linked: linked.length,
            medusa_total: medusaProducts.length,
        },
        correlation_id: correlationId,
    }
}

function buildLinkedProductEntry(
    map: {
        id: string
        contifico_id: string
        medusa_id: string
        metadata?: unknown
    },
    medusaById: Map<string, MedusaProductLike>,
    config: Awaited<ReturnType<typeof getContificoConfig>>["normalized"]
) {
    const medusaProduct = medusaById.get(map.medusa_id) as LinkedMedusaProductLike | undefined
    const medusaMissing = !medusaProduct
    const metadata = asProductMapMetadata(map.metadata)
    const variants = medusaProduct?.variants || []
    const weightedVariantWeights = variants.map((variant) => ({
        label: variant.title || variant.sku || variant.id,
        grams: getVariantWeightGrams(variant),
    }))
    const weightedMissingVariants = variants
        .filter((variant) => getVariantWeightGrams(variant) == null)
        .map((variant) => variant.title || variant.sku || variant.id)
    const effectiveMode = config ? getEffectiveMappingMode(config, metadata) : "auto"
    const effectiveWeightedPvp = config
        ? getEffectiveWeightedPvpField(config, metadata)
        : "pvp1"
    const effectiveRules = config
        ? resolveEffectiveProductRules(
              config.advanced_settings,
              metadata.product_rules_override || null
          )
        : null
    const weightedPriceSyncOverride =
        typeof metadata.product_rules_override?.weighted?.allow_weighted_price_sync ===
        "boolean"
            ? metadata.product_rules_override.weighted.allow_weighted_price_sync
            : null
    const linkOrigin = resolveProductLinkOrigin(metadata)

    return {
        map_id: map.id,
        contifico_id: map.contifico_id,
        contifico_nombre: metadata.nombre || "(requiere migración metadata)",
        contifico_codigo: metadata.codigo || "—",
        contifico_imagen: metadata.imagen || null,
        medusa_id: map.medusa_id,
        medusa_title: medusaProduct?.title || "Sin vínculo",
        medusa_sku: medusaProduct ? getPrimaryVariantSku(medusaProduct) : null,
        medusa_missing: medusaMissing,
        created_by_plugin: metadata.created === true,
        auto_linked: metadata.auto_linked === true,
        match_type: metadata.match_type || null,
        link_origin: linkOrigin,
        mapping_mode: effectiveMode,
        mapping_mode_override: metadata.mapping_mode_override || null,
        weighted_pvp_field: effectiveWeightedPvp,
        weighted_pvp_field_override: metadata.weighted_pvp_field || null,
        weighted_price_sync_enabled:
            effectiveRules?.weighted.allow_weighted_price_sync ?? false,
        weighted_price_sync_override: weightedPriceSyncOverride,
        weighted_missing_variants: weightedMissingVariants,
        weighted_variant_weights: weightedVariantWeights,
        weighted_ready:
            effectiveMode !== "weighted" || weightedMissingVariants.length === 0,
        weighted_variants_total: variants.length,
        weighted_variants_ready: variants.length - weightedMissingVariants.length,
        effective_rules: effectiveRules,
        diagnostics: {
            weighted_ready:
                effectiveMode !== "weighted" || weightedMissingVariants.length === 0,
            missing_variants: weightedMissingVariants,
            price_source:
                effectiveRules?.weighted.pricing_strategy || effectiveWeightedPvp,
            link_origin: linkOrigin,
        },
    }
}
