import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { CONTIFICO_MODULE } from "../../../../../modules/contifico"
import type ContificoModuleService from "../../../../../modules/contifico/service"
import { ContificoClient } from "../../../../../lib/client"
import {
    normalize,
    productSimilarity,
    SIMILARITY_THRESHOLD,
    type ProductMatch,
} from "../../../../../lib/similarity"

/**
 * GET /admin/contifico/products/match
 *
 * Compara productos de Contifico con los de Medusa y devuelve
 * sugerencias de match ordenadas por similitud.
 *
 * Query params:
 *  - skip_linked=true  → excluye productos ya vinculados (default: true)
 *  - min_score=0.45    → umbral mínimo de similitud
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    try {
        const skipLinked = req.query.skip_linked !== "false"
        const minScore = parseFloat(req.query.min_score as string) || SIMILARITY_THRESHOLD

        // 1. Obtener servicios
        const contificoService: ContificoModuleService =
            req.scope.resolve(CONTIFICO_MODULE)
        const productService: IProductModuleService =
            req.scope.resolve(Modules.PRODUCT)

        // 2. Obtener API key
        const [configs] = await contificoService.listAndCountContificoConfigs()
        const apiKey = configs[0]?.api_key
        if (!apiKey) {
            res.status(400).json({ error: "No hay API Key configurada." })
            return
        }

        // 3. Traer productos de Contifico (solo activos)
        const client = new ContificoClient({ apiKey })
        const contificoProducts = await client.getAllProductos()
        const activeContifico = contificoProducts.filter((p) => p.estado === "A")

        // 4. Traer productos de Medusa
        const medusaProducts = await productService.listProducts(
            {},
            { take: 5000, relations: ["variants"] }
        )

        // 5. Obtener mapeos existentes
        const [existingMaps] = await contificoService.listAndCountContificoEntityMaps({
            entity_type: "product",
        })
        const linkedContifico = new Set(existingMaps.map((m) => m.contifico_id))
        const linkedMedusa = new Set(existingMaps.map((m) => m.medusa_id))

        // 6. Preparar datos de Medusa para búsqueda rápida
        interface MedusaProductFlat {
            id: string
            title: string
            skus: string[]
            barcodes: string[]
            normalized_title: string
        }

        const medusaFlat: MedusaProductFlat[] = medusaProducts
            .filter((p) => !skipLinked || !linkedMedusa.has(p.id))
            .map((p) => ({
                id: p.id,
                title: p.title,
                skus: (p.variants || [])
                    .map((v: any) => v.sku)
                    .filter(Boolean) as string[],
                barcodes: (p.variants || [])
                    .map((v: any) => v.barcode)
                    .filter(Boolean) as string[],
                normalized_title: normalize(p.title),
            }))

        // Índice por SKU para match exacto rápido
        const medusaBySku = new Map<string, MedusaProductFlat>()
        const medusaByBarcode = new Map<string, MedusaProductFlat>()
        for (const mp of medusaFlat) {
            for (const sku of mp.skus) {
                medusaBySku.set(normalize(sku), mp)
            }
            for (const bc of mp.barcodes) {
                medusaByBarcode.set(normalize(bc), mp)
            }
        }

        // 7. Matching
        const matches: ProductMatch[] = []
        const matchedMedusaIds = new Set<string>()

        for (const cp of activeContifico) {
            if (skipLinked && linkedContifico.has(cp.id)) continue

            const codigoNorm = normalize(cp.codigo)
            const barraNorm = cp.codigo_barra ? normalize(cp.codigo_barra) : null

            // A) Match exacto por SKU/código
            const skuMatch = medusaBySku.get(codigoNorm)
            if (skuMatch && !matchedMedusaIds.has(skuMatch.id)) {
                matches.push({
                    contifico_id: cp.id,
                    contifico_nombre: cp.nombre,
                    contifico_codigo: cp.codigo,
                    medusa_id: skuMatch.id,
                    medusa_title: skuMatch.title,
                    medusa_sku: skuMatch.skus[0] || null,
                    similarity: 1,
                    match_type: "exact_sku",
                })
                matchedMedusaIds.add(skuMatch.id)
                continue
            }

            // B) Match exacto por código de barras
            if (barraNorm) {
                const bcMatch = medusaByBarcode.get(barraNorm)
                if (bcMatch && !matchedMedusaIds.has(bcMatch.id)) {
                    matches.push({
                        contifico_id: cp.id,
                        contifico_nombre: cp.nombre,
                        contifico_codigo: cp.codigo,
                        medusa_id: bcMatch.id,
                        medusa_title: bcMatch.title,
                        medusa_sku: bcMatch.skus[0] || null,
                        similarity: 1,
                        match_type: "barcode",
                    })
                    matchedMedusaIds.add(bcMatch.id)
                    continue
                }
            }

            // C) Similitud por nombre
            let bestMatch: { mp: MedusaProductFlat; score: number } | null = null
            const cpNameNorm = normalize(cp.nombre)

            for (const mp of medusaFlat) {
                if (matchedMedusaIds.has(mp.id)) continue

                // Match exacto de nombre normalizado
                if (cpNameNorm === mp.normalized_title) {
                    bestMatch = { mp, score: 1 }
                    break
                }

                const score = productSimilarity(cp.nombre, mp.title)
                if (score >= minScore && (!bestMatch || score > bestMatch.score)) {
                    bestMatch = { mp, score }
                }
            }

            if (bestMatch) {
                matches.push({
                    contifico_id: cp.id,
                    contifico_nombre: cp.nombre,
                    contifico_codigo: cp.codigo,
                    medusa_id: bestMatch.mp.id,
                    medusa_title: bestMatch.mp.title,
                    medusa_sku: bestMatch.mp.skus[0] || null,
                    similarity: Math.round(bestMatch.score * 100) / 100,
                    match_type:
                        bestMatch.score === 1 ? "exact_name" : "similar",
                })
                matchedMedusaIds.add(bestMatch.mp.id)
            }
        }

        // Ordenar: exactos primero, luego por score descendente
        matches.sort((a, b) => b.similarity - a.similarity)

        // Estadísticas
        const stats = {
            contifico_total: activeContifico.length,
            medusa_total: medusaProducts.length,
            already_linked: existingMaps.length,
            exact_sku: matches.filter((m) => m.match_type === "exact_sku").length,
            exact_name: matches.filter((m) => m.match_type === "exact_name").length,
            barcode: matches.filter((m) => m.match_type === "barcode").length,
            similar: matches.filter((m) => m.match_type === "similar").length,
            unmatched_contifico: activeContifico.filter(
                (cp) =>
                    !linkedContifico.has(cp.id) &&
                    !matches.some((m) => m.contifico_id === cp.id)
            ).length,
        }

        res.json({ matches, stats })
    } catch (error) {
        res.status(500).json({
            error: `Error en matching: ${(error as Error).message}`,
        })
    }
}
