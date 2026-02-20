import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTIFICO_MODULE } from "../../../../../modules/contifico"
import type ContificoModuleService from "../../../../../modules/contifico/service"
import { ContificoClient } from "../../../../../lib/client"

/**
 * GET /admin/contifico/config/bodegas
 * Lista las bodegas disponibles en Contifico para que el usuario
 * pueda elegir cual usar para sincronizar stock.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    try {
        const service: ContificoModuleService =
            req.scope.resolve(CONTIFICO_MODULE)
        const [configs] = await service.listAndCountContificoConfigs()
        const apiKey = configs[0]?.api_key

        if (!apiKey) {
            res.status(400).json({
                error: "No hay API Key configurada.",
            })
            return
        }

        const client = new ContificoClient({ apiKey })
        const bodegas = await client.getAllBodegas()

        res.json({ bodegas })
    } catch (error) {
        res.status(502).json({
            error: `Error obteniendo bodegas: ${(error as Error).message}`,
        })
    }
}
