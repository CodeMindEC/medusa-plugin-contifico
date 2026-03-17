import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getRequiredInvoiceConfig } from "../../../contifico/invoices/shared"
import { getContificoService } from "../../../contifico/shared"
import {
    createOrderInvoiceDocument,
    getOrderInvoiceDocumentsStatus,
    updateOrderInvoiceDocument,
} from "../../../../../lib/use-cases/invoice-documents"

interface InvoiceQueryService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const service = getContificoService(req.scope)
    const config = await getRequiredInvoiceConfig(service)

    try {
        const query = req.scope.resolve("query") as InvoiceQueryService
        const state = await getOrderInvoiceDocumentsStatus({
            service,
            query,
            config,
            order_id: req.params.id,
        })

        res.json(state)
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Error interno",
        })
    }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const service = getContificoService(req.scope)
    const config = await getRequiredInvoiceConfig(service)

    if (!config) {
        res.status(400).json({ error: "Configura la API Key de Contifico primero" })
        return
    }

    try {
        const query = req.scope.resolve("query") as InvoiceQueryService
        const state = await getOrderInvoiceDocumentsStatus({
            service,
            query,
            config,
            order_id: req.params.id,
        })
        const { tipo_documento, action } = (req.body || {}) as {
            tipo_documento?: "PRE" | "FAC"
            action?: "create" | "update"
        }
        const nextType = tipo_documento || state.next_action.tipo_documento
        const currentAction = action || "create"

        if (!["PRE", "FAC"].includes(nextType)) {
            res.status(400).json({ error: "tipo_documento debe ser PRE o FAC" })
            return
        }

        if (currentAction === "update") {
            const result = await updateOrderInvoiceDocument({
                service,
                query,
                config,
                order_id: req.params.id,
                tipo_documento: nextType,
                trigger: "manual-order-widget",
            })

            if (result.status === "blocked" || result.status === "invalid_state") {
                res.status(400).json({ error: result.reason })
                return
            }

            if (result.status === "not_found") {
                res.status(404).json({ error: result.reason })
                return
            }

            res.status(200).json({
                ok: true,
                status: result.status,
                correlation_id: result.correlation_id,
                documento: result.documento,
            })
            return
        }

        const result = await createOrderInvoiceDocument({
            service,
            query,
            config,
            order_id: req.params.id,
            tipo_documento: nextType,
            trigger: "manual-order-widget",
        })

        if (result.status === "blocked") {
            res.status(400).json({ error: result.reason })
            return
        }

        if (result.status === "not_found") {
            res.status(404).json({ error: result.reason })
            return
        }

        if (result.status === "duplicate") {
            res.status(409).json({
                error: `Ya existe un documento activo ${nextType} para esta orden`,
                existing: result.existing,
                correlation_id: result.correlation_id,
            })
            return
        }

        res.status(result.status === "linked" ? 200 : 201).json({
            ok: true,
            status: result.status,
            correlation_id: result.correlation_id,
            documento: result.documento,
        })
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Error interno",
        })
    }
}
