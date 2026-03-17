import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ContificoClient } from "../../../../../../lib/client"
import { getEffectiveMappingMode, getVariantWeightGrams } from "../../../../../../lib/contifico-weighted"
import { asProductMapMetadata } from "../../../../../../lib/contifico-metadata"
import {
    getPrimaryVariantSku,
    getVariantBarcodes,
    getVariantSkus,
    type MedusaProductLike,
} from "../../../../../../lib/medusa-product"
import { applyImportFilters } from "../../../../../../lib/product-filter"
import { resolveMatch } from "../../../../../../lib/strategies/matching"
import { resolveWeightedPresentationProfile } from "../../../../../../lib/weighted-presentation-profiles"
import { getContificoConfig, getContificoService } from "../../../shared"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    try {
        const contificoService = getContificoService(req.scope)
        const productService: IProductModuleService = req.scope.resolve(Modules.PRODUCT)
        const { normalized: config } = await getContificoConfig(contificoService)

        if (!config?.api_key) {
            res.status(400).json({
                ok: false,
                summary: {},
                decisions: [],
                warnings: [],
                blockers: ["Configura la API Key de Contifico primero."],
            })
            return
        }

        const client = new ContificoClient({ apiKey: config.api_key })
        const contificoProducts = await client.getAllProductos()
        const activeProducts = applyImportFilters(
            contificoProducts.filter((product) => product.estado === "A"),
            config.import_filters
        )
        const medusaProducts = await productService.listProducts(
            {},
            { take: 5000, relations: ["variants"] }
        )
        const [existingMaps] = await contificoService.listAndCountContificoEntityMaps(
            { entity_type: "product" },
            { take: 5000 }
        )

        const linkedContificoIds = new Set(existingMaps.map((item) => item.contifico_id))
        const linkedMedusaIds = new Set(existingMaps.map((item) => item.medusa_id))
        const weightedLinked = existingMaps.filter((item) => {
            const metadata = asProductMapMetadata(item.metadata)
            return getEffectiveMappingMode(config, metadata) === "weighted"
        })

        const candidateProducts = medusaProducts.map((product) => {
            const medusaProduct = product as MedusaProductLike
            return {
                id: product.id,
                title: product.title,
                sku: getPrimaryVariantSku(medusaProduct),
                skus: getVariantSkus(medusaProduct),
                barcodes: getVariantBarcodes(medusaProduct),
            }
        })

        let autoLinkCandidates = 0
        for (const contificoProduct of activeProducts) {
            if (linkedContificoIds.has(contificoProduct.id)) {
                continue
            }

            const available = candidateProducts.filter(
                (candidate) => !linkedMedusaIds.has(candidate.id)
            )
            const match = resolveMatch({
                contifico_id: contificoProduct.id,
                contifico_codigo: contificoProduct.codigo,
                contifico_nombre: contificoProduct.nombre,
                contifico_barcode: contificoProduct.codigo_barra || null,
                candidates: available,
                threshold: config.advanced_settings.matching.similarity_threshold,
                settings: config.advanced_settings.matching,
            })
            if (match.candidate) {
                autoLinkCandidates++
                linkedMedusaIds.add(match.candidate.id)
            }
        }

        const remainingAfterLinks = Math.max(
            0,
            activeProducts.length - linkedContificoIds.size - autoLinkCandidates
        )
        const unmatchedProducts = activeProducts.filter((product) => {
            if (linkedContificoIds.has(product.id)) {
                return false
            }

            const available = candidateProducts.filter(
                (candidate) => !linkedMedusaIds.has(candidate.id)
            )
            const match = resolveMatch({
                contifico_id: product.id,
                contifico_codigo: product.codigo,
                contifico_nombre: product.nombre,
                contifico_barcode: product.codigo_barra || null,
                candidates: available,
                threshold: config.advanced_settings.matching.similarity_threshold,
                settings: config.advanced_settings.matching,
            })

            return !match.candidate
        })
        const weightedAutoCreateResolutions =
            config.variant_mode === "weighted"
                ? unmatchedProducts.map((product) => ({
                      product,
                      resolution: resolveWeightedPresentationProfile(product, {
                          creation_mode: config.advanced_settings.weighted.creation_mode,
                          default_profile_id: config.advanced_settings.weighted.default_profile_id,
                          creation_profiles: config.advanced_settings.weighted.creation_profiles,
                      }),
                  }))
                : []
        const weightedWouldCreate = weightedAutoCreateResolutions.filter(
            (item) => !!item.resolution.profile
        ).length
        const weightedManualReview = weightedAutoCreateResolutions.filter(
            (item) => !item.resolution.profile
        )
        const weightedMissing = weightedLinked
            .map((item) => {
                const product = medusaProducts.find((medusa) => medusa.id === item.medusa_id)
                const variants = (product?.variants || []).filter(Boolean)
                const missing = variants
                    .filter((variant) => getVariantWeightGrams(variant) == null)
                    .map((variant) => variant.title || variant.sku || variant.id)

                return {
                    medusa_id: item.medusa_id,
                    contifico_id: item.contifico_id,
                    missing,
                    total: variants.length,
                    ready: variants.length > 0 && missing.length === 0,
                }
            })
            .filter((item) => item.missing.length > 0)

        res.json({
            ok: true,
            summary: {
                contifico_total: contificoProducts.length,
                active_products: activeProducts.length,
                already_linked: linkedContificoIds.size,
                auto_link_candidates: autoLinkCandidates,
                would_create:
                    config.variant_mode === "weighted"
                        ? weightedWouldCreate
                        : remainingAfterLinks,
                manual_review:
                    config.variant_mode === "weighted"
                        ? weightedManualReview.length
                        : 0,
                weighted_linked: weightedLinked.length,
                weighted_missing_weights: weightedMissing.length,
            },
            decisions: [
                {
                    strategy: "matching:priority",
                    value: config.advanced_settings.matching.priority,
                    reason: "Prioridad efectiva de matching",
                },
                {
                    strategy: "stock:mode",
                    value: config.advanced_settings.stock.mode,
                    reason: "Modo efectivo de sincronización de stock",
                },
                {
                    strategy: "weighted_creation:mode",
                    value: config.advanced_settings.weighted.creation_mode,
                    reason:
                        config.variant_mode === "weighted"
                            ? "Modo efectivo de auto-creación weighted"
                            : "No aplica porque el modo de mapeo no es weighted",
                },
                {
                    strategy: "weighted_creation:profiles_configured",
                    value: config.advanced_settings.weighted.creation_profiles.length,
                    reason:
                        config.variant_mode === "weighted"
                            ? "Cantidad de perfiles weighted disponibles para crear productos sin match"
                            : "No aplica porque el modo de mapeo no es weighted",
                },
                {
                    strategy: "weighted_creation:default_profile",
                    value: config.advanced_settings.weighted.default_profile_id,
                    reason:
                        config.variant_mode === "weighted"
                            ? "Perfil fallback cuando no hay coincidencia específica"
                            : "No aplica porque el modo de mapeo no es weighted",
                },
                {
                    strategy: "sync_behavior:dry_run_enabled",
                    value: config.advanced_settings.sync_behavior.dry_run_enabled,
                    reason: "La simulación usa configuración de dry run",
                },
            ],
            warnings: [
                ...weightedMissing.slice(0, 20).map((item) =>
                    `${item.contifico_id}: faltan pesos en ${item.missing.join(", ")}`
                ),
                ...weightedManualReview.slice(0, 20).map(
                    ({ product, resolution }) =>
                        `${product.codigo}: ${resolution.decision.reason}`
                ),
                ...weightedManualReview
                    .flatMap(({ product, resolution }) =>
                        (resolution.warnings || []).map(
                            (warning) => `${product.codigo}: ${warning}`
                        )
                    )
                    .slice(0, 20),
            ],
            blockers: [],
        })
    } catch (error) {
        res.status(500).json({
            ok: false,
            summary: {},
            decisions: [],
            warnings: [],
            blockers: [error instanceof Error ? error.message : "Error generando preview"],
        })
    }
}
