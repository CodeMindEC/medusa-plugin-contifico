import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { CONTIFICO_MODULE } from "../modules/contifico"
import type ContificoModuleService from "../modules/contifico/service"
import {
    createOrderInvoiceDocument,
} from "../lib/use-cases/invoice-documents"
import {
    bindContificoLogger,
    createCorrelationId,
    logContificoEvent,
} from "../lib/observability"
import { getRequiredInvoiceConfig } from "../api/admin/contifico/invoices/shared"

interface SubscriberQueryService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

export default async function contificoOrderPlacedHandler({
    event: { data },
    container,
}: SubscriberArgs<{ id: string }>) {
    bindContificoLogger(container)
    const correlationId = createCorrelationId("contifico_order_placed")
    const service: ContificoModuleService = container.resolve(CONTIFICO_MODULE)
    const config = await getRequiredInvoiceConfig(service)

    if (!config?.api_key || !config.api_pos || !config.auto_preinvoice_enabled) {
        logContificoEvent("debug", "PRE automática omitida: config incompleta", {
            correlation_id: correlationId,
            operation: "subscriber.order_placed",
            has_api_key: !!config?.api_key,
            has_api_pos: !!config?.api_pos,
            auto_preinvoice_enabled: !!config?.auto_preinvoice_enabled,
        })
        return
    }

    const orderId = data.id

    try {
        const query = container.resolve("query") as SubscriberQueryService
        const result = await createOrderInvoiceDocument({
            service,
            query,
            config,
            order_id: orderId,
            tipo_documento: "PRE",
            trigger: "order.placed",
            correlation_id: correlationId,
        })

        if (result.status === "created") {
            logContificoEvent("info", "Prefactura creada por order.placed", {
                correlation_id: correlationId,
                operation: "subscriber.order_placed",
                order_id: orderId,
                contifico_id: result.documento?.id || null,
            })
        }
    } catch (error) {
        logContificoEvent(
            "error",
            "Error creando prefactura automática",
            {
                correlation_id: correlationId,
                operation: "subscriber.order_placed",
                order_id: orderId,
            },
            error
        )
    }
}

export const config: SubscriberConfig = {
    event: "order.placed",
}
