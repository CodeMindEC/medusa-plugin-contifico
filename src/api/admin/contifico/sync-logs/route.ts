import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTIFICO_MODULE } from "../../../../modules/contifico"
import type ContificoModuleService from "../../../../modules/contifico/service"

/**
 * GET /admin/contifico/sync-logs
 * Lista los ultimos registros de sincronizacion.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const service: ContificoModuleService = req.scope.resolve(CONTIFICO_MODULE)

    const limit = Number(req.query.limit) || 20
    const offset = Number(req.query.offset) || 0
    const syncType = req.query.sync_type as string | undefined
    const status = req.query.status as string | string[] | undefined
    const parentLogId = req.query.parent_log_id as string | undefined

    const filters: Record<string, unknown> = {}
    if (syncType) {
        filters.sync_type = syncType
    }
    if (status) {
        filters.status = status
    }
    if (parentLogId) {
        filters.parent_log_id = parentLogId
    }

    const [logs, count] = await service.listAndCountContificoSyncLogs(filters, {
        order: { created_at: "DESC" },
        take: limit,
        skip: offset,
    })

    res.json({ sync_logs: logs, count, limit, offset })
}
