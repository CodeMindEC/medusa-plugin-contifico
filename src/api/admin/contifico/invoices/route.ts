import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    createInvoice,
    createTestInvoice,
    deleteTestInvoices,
    listInvoices,
} from "./actions"
import { getRequiredInvoiceConfig } from "./shared"
import { getContificoService } from "../shared"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    return listInvoices(req, res, getContificoService(req.scope))
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const service = getContificoService(req.scope)
    const { action = "create" } = req.body as { action?: string }
    const config = await getRequiredInvoiceConfig(service)

    if (!config) {
        res.status(400).json({ error: "Configura la API Key de Contifico primero" })
        return
    }

    switch (action) {
        case "create":
            return createInvoice(req, res, service, config)
        case "create-test":
            return createTestInvoice(req, res, service, config)
        case "delete-tests":
            return deleteTestInvoices(res, service, config)
        default:
            res.status(400).json({ error: `Accion desconocida: ${action}` })
    }
}
