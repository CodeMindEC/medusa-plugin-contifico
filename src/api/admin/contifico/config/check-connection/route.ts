import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTIFICO_MODULE } from "../../../../../modules/contifico"
import type ContificoModuleService from "../../../../../modules/contifico/service"
import { ContificoClient } from "../../../../../lib/client"

/**
 * POST /admin/contifico/config/check-connection
 * Prueba la conexion con la API de Contifico usando la API Key guardada
 * o una proporcionada en el body.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    try {
        let apiKey = (req.body as any)?.api_key

        if (!apiKey) {
            // Usar la key guardada en la config
            const service: ContificoModuleService =
                req.scope.resolve(CONTIFICO_MODULE)
            const [configs] = await service.listAndCountContificoConfigs()
            apiKey = configs[0]?.api_key
        }

        if (!apiKey) {
            res.status(400).json({
                ok: false,
                error: "No hay API Key configurada. Guarda la configuracion primero.",
            })
            return
        }

        const client = new ContificoClient({ apiKey, timeout: 10000, retries: 0 })
        const result = await client.testConnection()

        res.json({
            ok: true,
            message: `Conexion exitosa. ${result.bodegas} bodega(s) encontrada(s).`,
            bodegas: result.bodegas,
        })
    } catch (error) {
        res.status(502).json({
            ok: false,
            error: `Error de conexion: ${(error as Error).message}`,
        })
    }
}
