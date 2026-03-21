import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTIFICO_MODULE } from "../../../../modules/contifico"
import type ContificoModuleService from "../../../../modules/contifico/service"
import { SyncLogsQuerySchema } from "../invoices/validators"

/**
 * GET /admin/contifico/sync-logs
 * Lista los ultimos registros de sincronizacion.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const service: ContificoModuleService = req.scope.resolve(CONTIFICO_MODULE)

    const parsed = SyncLogsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
        res.status(400).json({
            error: parsed.error.issues.map((i) => i.message).join("; "),
        })
        return
    }

    const { limit, offset, sync_type: syncType, status, parent_log_id: parentLogId } = parsed.data

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
