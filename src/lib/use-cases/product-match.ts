import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ContificoClient } from "../client"
import { asProductMapMetadata } from "../contifico-metadata"
import {
    getPrimaryVariantSku,
    getVariantBarcodes,
    getVariantSkus,
    type MedusaProductLike,
} from "../medusa-product"
import { applyImportFilters } from "../product-filter"
import { createCorrelationId, logContificoEvent } from "../observability"
import { getContificoConfig, getContificoService } from "../../api/admin/contifico/shared"
import { resolveMatch } from "../strategies/matching"
import {
    SIMILARITY_THRESHOLD,
    productSimilarity,
    type ProductMatch,
} from "../similarity"

export async function runProductMatch(req: MedusaRequest, res: MedusaResponse) {
    const correlationId = createCorrelationId("contifico_product_match")

    try {
        const skipLinked = req.query.skip_linked !== "false"
        const contificoService = getContificoService(req.scope)
        const productService: IProductModuleService = req.scope.resolve(Modules.PRODUCT)

        const { normalized: config } = await getContificoConfig(contificoService)
        if (!config?.api_key) {
            res.status(400).json({ error: "No hay API Key configurada." })
            return
        }

        const configuredThreshold =
            config.advanced_settings.matching.similarity_threshold
        const minScoreQuery = Number.parseFloat(String(req.query.min_score || ""))
        const minScore = Number.isFinite(minScoreQuery)
            ? minScoreQuery
            : configuredThreshold || SIMILARITY_THRESHOLD

        const client = new ContificoClient({ apiKey: config.api_key })
        const contificoProducts = await client.getAllProductos()
        let activeContifico = contificoProducts.filter((p) => p.estado === "A")
        activeContifico = applyImportFilters(activeContifico, config.import_filters)

        const medusaProducts = await productService.listProducts(
            {},
            { take: 5000, relations: ["variants"] }
        )

        const [existingMaps] = await contificoService.listAndCountContificoEntityMaps({
            entity_type: "product",
        })
        const activeMaps = existingMaps.filter(
            (map) => asProductMapMetadata(map.metadata).sync_state?.cleanup_state !== "pending"
        )
        const linkedContifico = new Set(activeMaps.map((m) => m.contifico_id))
        const linkedMedusa = new Set(activeMaps.map((m) => m.medusa_id))

        type MedusaProductSimplified = {
            id: string
            title: string
            skus: string[]
            barcodes: string[]
            sku: string | null
        }

        const medusaSimplified: MedusaProductSimplified[] = medusaProducts.map((p) => {
            const medusaProduct = p as MedusaProductLike
            return {
                id: p.id,
                title: p.title,
                skus: getVariantSkus(medusaProduct),
                barcodes: getVariantBarcodes(medusaProduct),
                sku: getPrimaryVariantSku(medusaProduct),
            }
        })

        const all_medusa = medusaSimplified
            .map(({ id, title, sku }) => ({
                medusa_id: id,
                medusa_title: title,
                medusa_sku: sku,
            }))
            .sort((a, b) => a.medusa_title.localeCompare(b.medusa_title))
        const available_medusa = all_medusa.filter(
            (m) => !linkedMedusa.has(m.medusa_id)
        )

        const matches: ProductMatch[] = []
        const matchedMedusaIds = new Set<string>()

        type ContificoProductType = {
            id: string
            nombre: string
            codigo: string
            imagen?: string | null
            codigo_barra?: string | null
        }

        const createMatch = (
            cp: ContificoProductType,
            mp: MedusaProductSimplified,
            similarity: number,
            match_type: ProductMatch["match_type"]
        ): ProductMatch => ({
            contifico_id: cp.id,
            contifico_nombre: cp.nombre,
            contifico_codigo: cp.codigo,
            contifico_imagen: cp.imagen || null,
            medusa_id: mp.id,
            medusa_title: mp.title,
            medusa_sku: mp.sku,
            similarity,
            match_type,
        })

        for (const cp of activeContifico) {
            if (skipLinked && linkedContifico.has(cp.id)) continue

            const candidates = medusaSimplified.filter(
                (candidate) =>
                    (!skipLinked || !linkedMedusa.has(candidate.id)) &&
                    !matchedMedusaIds.has(candidate.id)
            )
            const result = resolveMatch({
                contifico_id: cp.id,
                contifico_codigo: cp.codigo,
                contifico_nombre: cp.nombre,
                contifico_barcode: cp.codigo_barra || null,
                candidates,
                threshold: minScore,
                settings: config.advanced_settings.matching,
            })

            if (result.candidate && result.match_type) {
                matches.push(
                    createMatch(
                        cp,
                        result.candidate,
                        Math.round(result.similarity * 100) / 100,
                        result.match_type === "exact_name"
                            ? "exact_name"
                            : result.match_type === "exact_sku"
                              ? "exact_sku"
                              : result.match_type === "barcode"
                                ? "barcode"
                                : "similar"
                    )
                )
                matchedMedusaIds.add(result.candidate.id)
            }
        }
        matches.sort((a, b) => b.similarity - a.similarity)

        const unmatched = activeContifico
            .filter(
                (cp) =>
                    !linkedContifico.has(cp.id) &&
                    !matches.some((m) => m.contifico_id === cp.id)
            )
            .map((cp) => ({
                contifico_id: cp.id,
                contifico_nombre: cp.nombre,
                contifico_codigo: cp.codigo,
                contifico_imagen: cp.imagen || null,
            }))
            .sort((a, b) => a.contifico_nombre.localeCompare(b.contifico_nombre))

        const relinkCandidates = activeMaps
            .filter((m) => asProductMapMetadata(m.metadata).created === true)
            .map((pm) => {
                const meta = asProductMapMetadata(pm.metadata)
                const currentMedusa = medusaSimplified.find((p) => p.id === pm.medusa_id)
                if (!currentMedusa) return null

                let best: { mp: MedusaProductSimplified; score: number } | null = null
                for (const mp of medusaSimplified) {
                    if (mp.id === pm.medusa_id || linkedMedusa.has(mp.id)) continue
                    const sim = productSimilarity(meta.nombre || "", mp.title)
                    if (sim >= 0.3 && (!best || sim > best.score)) {
                        best = { mp, score: sim }
                    }
                }
                if (!best) return null

                return {
                    contifico_id: pm.contifico_id,
                    contifico_nombre: meta.nombre || "",
                    contifico_codigo: meta.codigo || "",
                    current_medusa_id: pm.medusa_id,
                    current_medusa_title: currentMedusa.title,
                    suggested_medusa_id: best.mp.id,
                    suggested_medusa_title: best.mp.title,
                    suggested_medusa_sku: best.mp.sku,
                    similarity: best.score,
                }
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .sort((a, b) => b.similarity - a.similarity)

        const stats = {
            contifico_total: activeContifico.length,
            medusa_total: medusaProducts.length,
            already_linked: activeMaps.length,
            exact_sku: matches.filter((m) => m.match_type === "exact_sku").length,
            exact_name: matches.filter((m) => m.match_type === "exact_name").length,
            barcode: matches.filter((m) => m.match_type === "barcode").length,
            similar: matches.filter((m) => m.match_type === "similar").length,
            unmatched_contifico: unmatched.length,
            relink_candidates: relinkCandidates.length,
        }

        logContificoEvent("info", "Product match computed", {
            correlation_id: correlationId,
            operation: "product_match.run",
            matches: matches.length,
            unmatched: unmatched.length,
            relink_candidates: relinkCandidates.length,
        })

        res.json({
            matches,
            unmatched,
            available_medusa,
            relink_candidates: relinkCandidates,
            all_medusa,
            stats,
        })
    } catch (error) {
        logContificoEvent(
            "error",
            "Product match failed",
            {
                correlation_id: correlationId,
                operation: "product_match.run",
            },
            error
        )
        res.status(500).json({
            error: `Error en matching: ${(error as Error).message}`,
        })
    }
}
