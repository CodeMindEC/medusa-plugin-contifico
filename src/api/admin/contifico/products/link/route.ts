import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTIFICO_MODULE } from "../../../../../modules/contifico"
import type ContificoModuleService from "../../../../../modules/contifico/service"

/**
 * POST /admin/contifico/products/link
 *
 * Vincula uno o más productos de Contifico con sus equivalentes de Medusa.
 *
 * Body:
 * {
 *   links: [
 *     { contifico_id: "...", medusa_id: "...", contifico_codigo: "ABC" },
 *     ...
 *   ]
 * }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    try {
        const { links } = req.body as {
            links: Array<{
                contifico_id: string
                medusa_id: string
                contifico_codigo?: string
            }>
        }

        if (!links || !Array.isArray(links) || links.length === 0) {
            res.status(400).json({ error: "Se requiere un array de links." })
            return
        }

        const service: ContificoModuleService =
            req.scope.resolve(CONTIFICO_MODULE)

        const created: Array<{ medusa_id: string; contifico_id: string }> = []
        const skipped: Array<{
            medusa_id: string
            contifico_id: string
            reason: string
        }> = []

        for (const link of links) {
            if (!link.contifico_id || !link.medusa_id) {
                skipped.push({
                    ...link,
                    reason: "Faltan contifico_id o medusa_id",
                })
                continue
            }

            // Verificar si ya existe un mapeo para este producto de Medusa
            const [existing] =
                await service.listAndCountContificoEntityMaps({
                    entity_type: "product",
                    medusa_id: link.medusa_id,
                })

            if (existing.length > 0) {
                skipped.push({
                    ...link,
                    reason: "Ya existe un mapeo para este producto de Medusa",
                })
                continue
            }

            // Verificar si ya existe un mapeo para este producto de Contifico
            const [existingContifico] =
                await service.listAndCountContificoEntityMaps({
                    entity_type: "product",
                    contifico_id: link.contifico_id,
                })

            if (existingContifico.length > 0) {
                skipped.push({
                    ...link,
                    reason: "Ya existe un mapeo para este producto de Contifico",
                })
                continue
            }

            await service.createContificoEntityMaps({
                entity_type: "product",
                medusa_id: link.medusa_id,
                contifico_id: link.contifico_id,
                metadata: link.contifico_codigo
                    ? { codigo: link.contifico_codigo }
                    : null,
            })

            created.push({
                medusa_id: link.medusa_id,
                contifico_id: link.contifico_id,
            })
        }

        res.json({
            linked: created.length,
            skipped: skipped.length,
            details: { created, skipped },
        })
    } catch (error) {
        res.status(500).json({
            error: `Error vinculando productos: ${(error as Error).message}`,
        })
    }
}

/**
 * DELETE /admin/contifico/products/link
 *
 * Desvincula un producto.
 *
 * Body: { medusa_id: "prod_xxx" }
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
    try {
        const { medusa_id } = req.body as { medusa_id: string }

        if (!medusa_id) {
            res.status(400).json({ error: "Se requiere medusa_id." })
            return
        }

        const service: ContificoModuleService =
            req.scope.resolve(CONTIFICO_MODULE)

        const [existing] =
            await service.listAndCountContificoEntityMaps({
                entity_type: "product",
                medusa_id,
            })

        if (existing.length === 0) {
            res.status(404).json({ error: "No se encontro el mapeo." })
            return
        }

        await service.deleteContificoEntityMaps(existing[0].id)

        res.json({ ok: true })
    } catch (error) {
        res.status(500).json({
            error: `Error desvinculando: ${(error as Error).message}`,
        })
    }
}
