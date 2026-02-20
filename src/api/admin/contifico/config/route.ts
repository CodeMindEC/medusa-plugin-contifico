import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTIFICO_MODULE } from "../../../../modules/contifico"
import type ContificoModuleService from "../../../../modules/contifico/service"
import { UpdateContificoConfigSchema } from "../validators"
import { fromCSV, toCSV } from "../../../../lib/csv"

/**
 * GET /admin/contifico/config
 * Obtiene la configuracion actual de Contifico.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const service: ContificoModuleService = req.scope.resolve(CONTIFICO_MODULE)
    const [configs] = await service.listAndCountContificoConfigs()
    const raw = configs[0] ?? null

    // Enviar bodega_ids como array al frontend
    const config = raw
        ? { ...raw, bodega_ids: fromCSV(raw.bodega_ids) }
        : null

    res.json({ config })
}

/**
 * POST /admin/contifico/config
 * Crea o actualiza la configuracion de Contifico.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const parsed = UpdateContificoConfigSchema.safeParse(req.body)

    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() })
        return
    }

    const service: ContificoModuleService = req.scope.resolve(CONTIFICO_MODULE)
    const [existing] = await service.listAndCountContificoConfigs()

    // Convertir array de bodega_ids a CSV para guardar
    const dataToSave = {
        ...parsed.data,
        bodega_ids: toCSV(parsed.data.bodega_ids),
    }

    try {
        let config
        if (existing.length > 0) {
            // Actualizar config existente
            config = await service.updateContificoConfigs(
                { id: existing[0].id, ...dataToSave }
            )
        } else {
            // Crear nueva config
            config = await service.createContificoConfigs(dataToSave)
        }

        // Devolver bodega_ids como array
        res.json({ config: { ...config, bodega_ids: fromCSV(config.bodega_ids) } })
    } catch (err: any) {
        console.error("[Contifico] Error guardando config:", err)
        res.status(500).json({
            error: err?.message || "Error interno al guardar configuración. Verifica que las migraciones estén al día.",
        })
    }
}
