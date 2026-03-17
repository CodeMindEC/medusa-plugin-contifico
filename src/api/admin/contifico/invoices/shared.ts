import { ContificoClient } from "../../../../lib/client"
import {
    asInvoiceMapMetadata,
    buildInvoiceMapMetadata,
    type InvoiceEntityMapMetadata,
} from "../../../../lib/contifico-metadata"
import type ContificoModuleService from "../../../../modules/contifico/service"
export {
    buildOrderInvoiceReference,
    buildDocumentoFromOrder,
    calculateOrderTotalsFromOrder,
    createTestDocumentoPayload,
    getRequiredInvoiceConfig,
    isTestRef,
    type InvoiceConfig,
    type InvoiceOrderGraph,
} from "../../../../lib/use-cases/invoice-payload"

export const ORDER_INVOICE_GRAPH_FIELDS = [
    "id",
    "display_id",
    "email",
    "payment_status",
    "updated_at",
    "metadata",
    "customer_id",
    "customer.first_name",
    "customer.last_name",
    "customer.email",
    "customer.metadata",
    "items.id",
    "items.title",
    "items.variant_id",
    "items.product_id",
    "items.unit_price",
    "items.quantity",
    "items.variant.title",
    "items.variant.sku",
    "items.variant.weight",
    "items.variant.metadata",
    "items.detail.quantity",
    "items.detail.unit_price",
    "items.adjustments.id",
    "items.adjustments.amount",
    "items.adjustments.code",
    "items.adjustments.description",
    "shipping_address.first_name",
    "shipping_address.last_name",
    "shipping_address.address_1",
    "shipping_address.city",
    "shipping_address.phone",
    "shipping_address.metadata",
    "billing_address.first_name",
    "billing_address.last_name",
    "billing_address.address_1",
    "billing_address.city",
    "billing_address.phone",
    "billing_address.metadata",
] as const

export function getInvoiceMetadata(metadata: unknown): InvoiceEntityMapMetadata {
    return buildInvoiceMapMetadata(asInvoiceMapMetadata(metadata)) || {}
}

export async function createClient(config: { api_key: string; api_pos?: string | null }) {
    return new ContificoClient({
        apiKey: config.api_key,
        apiPos: config.api_pos || undefined,
    })
}

export async function logInvoiceSync(
    service: ContificoModuleService,
    payload: {
        status: "success" | "partial" | "error"
        total_processed: number
        total_errors: number
        details: Record<string, unknown>
    }
) {
    await service.createContificoSyncLogs({
        sync_type: "invoice",
        status: payload.status,
        total_processed: payload.total_processed,
        total_errors: payload.total_errors,
        details: payload.details,
        duration_ms: 0,
        started_at: new Date().toISOString(),
    })
}
