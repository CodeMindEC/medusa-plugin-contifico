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

interface PaymentGraph {
    id: string
    payment_collection?: {
        order?: {
            id?: string | null
        } | null
    } | null
}

interface SubscriberQueryService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

export default async function contificoPaymentCapturedHandler({
    event: { data },
    container,
}: SubscriberArgs<{ id: string }>) {
    bindContificoLogger(container)
    const correlationId = createCorrelationId("contifico_payment_captured")
    const service: ContificoModuleService = container.resolve(CONTIFICO_MODULE)
    const config = await getRequiredInvoiceConfig(service)

    if (!config?.api_key || !config.api_pos || !config.auto_invoice_enabled) {
        return
    }

    const paymentId = data.id

    try {
        const query = container.resolve("query") as SubscriberQueryService
        const { data: payments } = await query.graph<PaymentGraph>({
            entity: "payment",
            fields: ["id", "payment_collection.order.id"],
            filters: { id: paymentId },
        })

        const orderId = payments[0]?.payment_collection?.order?.id
        if (!orderId) {
            return
        }

        const result = await createOrderInvoiceDocument({
            service,
            query,
            config,
            order_id: orderId,
            tipo_documento: "FAC",
            trigger: "payment.captured",
            correlation_id: correlationId,
        })

        if (result.status === "created") {
            logContificoEvent("info", "Factura creada automaticamente", {
                correlation_id: correlationId,
                operation: "subscriber.payment_captured",
                payment_id: paymentId,
                order_id: orderId,
                contifico_id: result.documento?.id || null,
            })
        }
    } catch (error) {
        logContificoEvent(
            "error",
            "Error creando factura automática",
            {
                correlation_id: correlationId,
                operation: "subscriber.payment_captured",
                payment_id: paymentId,
            },
            error
        )
    }
}

export const config: SubscriberConfig = {
    event: "payment.captured",
}
