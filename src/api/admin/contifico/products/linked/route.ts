import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { CONTIFICO_MODULE } from "../../../../../modules/contifico"
import type ContificoModuleService from "../../../../../modules/contifico/service"
import { ContificoClient } from "../../../../../lib/client"

/**
 * GET /admin/contifico/products/linked
 *
 * Devuelve 3 listas:
 *  - linked: productos que ya están vinculados (Contifico ↔ Medusa)
 *  - unlinked_contifico: productos en Contifico sin vínculo en Medusa
 *  - unlinked_medusa: productos en Medusa sin vínculo en Contifico
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    try {
        const contificoService: ContificoModuleService =
            req.scope.resolve(CONTIFICO_MODULE)
        const productService: IProductModuleService =
            req.scope.resolve(Modules.PRODUCT)

        // Config
        const [configs] = await contificoService.listAndCountContificoConfigs()
        const apiKey = configs[0]?.api_key
        if (!apiKey) {
            res.status(400).json({ error: "No hay API Key configurada." })
            return
        }

        // Entity maps
        const [entityMaps] =
            await contificoService.listAndCountContificoEntityMaps(
                { entity_type: "product" },
                { take: 5000 }
            )
        const mapByContifico = new Map(
            entityMaps.map((m) => [m.contifico_id, m])
        )
        const mapByMedusa = new Map(
            entityMaps.map((m) => [m.medusa_id, m])
        )

        // Productos de Contifico (solo activos)
        const client = new ContificoClient({ apiKey })
        const contificoProducts = await client.getAllProductos()
        const activeContifico = contificoProducts.filter(
            (p) => p.estado === "A"
        )

        // Productos de Medusa
        const medusaProducts = await productService.listProducts(
            {},
            { take: 5000, relations: ["variants"] }
        )
        const medusaById = new Map(medusaProducts.map((p) => [p.id, p]))

        // ── Linked ──
        const linked = entityMaps
            .map((m) => {
                const cp = activeContifico.find((p) => p.id === m.contifico_id)
                const mp = medusaById.get(m.medusa_id)
                return {
                    map_id: m.id,
                    contifico_id: m.contifico_id,
                    contifico_nombre: cp?.nombre || "(eliminado en Contifico)",
                    contifico_codigo: cp?.codigo || m.metadata?.codigo || "—",
                    medusa_id: m.medusa_id,
                    medusa_title: mp?.title || "(eliminado en Medusa)",
                    medusa_sku:
                        (mp?.variants as any)?.[0]?.sku || null,
                    created_by_plugin: m.metadata?.created === true,
                    auto_linked: m.metadata?.auto_linked === true,
                    match_type: m.metadata?.match_type || null,
                }
            })
            .sort((a, b) => a.contifico_nombre.localeCompare(b.contifico_nombre))

        // ── Unlinked Contifico ──
        const unlinkedContifico = activeContifico
            .filter((cp) => !mapByContifico.has(cp.id))
            .map((cp) => ({
                contifico_id: cp.id,
                contifico_nombre: cp.nombre,
                contifico_codigo: cp.codigo,
                contifico_imagen: cp.imagen || null,
            }))
            .sort((a, b) => a.contifico_nombre.localeCompare(b.contifico_nombre))

        // ── Unlinked Medusa ──
        const unlinkedMedusa = medusaProducts
            .filter((mp) => !mapByMedusa.has(mp.id))
            .map((mp) => ({
                medusa_id: mp.id,
                medusa_title: mp.title,
                medusa_sku: (mp.variants as any)?.[0]?.sku || null,
                medusa_thumbnail: mp.thumbnail || null,
            }))
            .sort((a, b) => a.medusa_title.localeCompare(b.medusa_title))

        res.json({
            linked,
            unlinked_contifico: unlinkedContifico,
            unlinked_medusa: unlinkedMedusa,
            stats: {
                total_linked: linked.length,
                total_unlinked_contifico: unlinkedContifico.length,
                total_unlinked_medusa: unlinkedMedusa.length,
                contifico_total: activeContifico.length,
                medusa_total: medusaProducts.length,
            },
        })
    } catch (error) {
        res.status(500).json({
            error: `Error obteniendo productos: ${(error as Error).message}`,
        })
    }
}
