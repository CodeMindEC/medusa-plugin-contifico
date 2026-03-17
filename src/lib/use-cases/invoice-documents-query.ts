/**
 * Invoice document status queries and order loading.
 * Provides getOrderInvoiceDocumentsStatus and loadInvoiceOrder.
 */

import { buildInvoiceMapMetadata } from "../contifico-metadata"
import { createCorrelationId } from "../observability"
import type ContificoModuleService from "../../modules/contifico/service"
import {
    buildDocumentoFromOrder,
    createClient,
    getInvoiceMetadata,
    isTestRef,
    ORDER_INVOICE_GRAPH_FIELDS,
    type InvoiceConfig,
    type InvoiceOrderGraph,
} from "../../api/admin/contifico/invoices/shared"
import type {
    GetOrderInvoiceDocumentsStatusInput,
    GetOrderInvoiceDocumentsStatusResult,
    InvoiceDocumentActionState,
    InvoiceDocumentSummary,
} from "./invoice-documents"
import {
    findInvoiceMapForOrder,
    findRemoteDocumentByReference,
    persistInvoiceMapForOrder,
    findActiveInvoiceMapForOrder,
} from "./invoice-idempotency"
import {
    emptyInvoiceDocumentSummary,
    extractDocumentClientIdentification,
    extractDocumentClientName,
} from "./invoice-documents-utils"

type InvoiceDocumentType = "PRE" | "FAC"

interface InvoiceQueryService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

// ── Public ───────────────────────────────────────────────

export async function getOrderInvoiceDocumentsStatus(
    input: GetOrderInvoiceDocumentsStatusInput
): Promise<GetOrderInvoiceDocumentsStatusResult> {
    const correlationId =
        input.correlation_id || createCorrelationId("contifico_order_documents")
    const order = await loadInvoiceOrder(input.query, input.order_id)

    if (!order) {
        throw new Error(`Orden ${input.order_id} no encontrada`)
    }

    const clientFactory = input.clientFactory || createClient
    const client = input.config ? await clientFactory(input.config) : null
    const pre = await resolveOrderInvoiceDocumentSummary({
        service: input.service,
        config: input.config,
        client,
        order,
        tipo_documento: "PRE",
        correlation_id: correlationId,
    })
    const fac = await resolveOrderInvoiceDocumentSummary({
        service: input.service,
        config: input.config,
        client,
        order,
        tipo_documento: "FAC",
        correlation_id: correlationId,
    })

    const isPaymentCaptured = order.payment_status === "captured"

    let is_order_modified = false
    const localPreMap = await findInvoiceMapForOrder(input.service, input.order_id, "PRE")
    if (pre.exists && order.updated_at && localPreMap?.updated_at) {
        const orderUpdated = new Date(order.updated_at).getTime()
        const mapUpdated = new Date(localPreMap.updated_at).getTime()
        if (orderUpdated > mapUpdated && input.config) {
            try {
                const payload = await buildDocumentoFromOrder(order, "PRE", input.service, input.config)
                if (Number(payload.total) !== Number(pre.total)) {
                    is_order_modified = true
                }
            } catch (e) {
                is_order_modified = true
            }
        }
    }

    const actions = {
        PRE: buildInvoiceDocumentActionState("PRE", pre, {
            api_key_configured: !!input.config?.api_key,
            api_pos_configured: !!input.config?.api_pos,
            payment_captured: isPaymentCaptured,
            is_order_modified,
        }),
        FAC: buildInvoiceDocumentActionState("FAC", fac, {
            api_key_configured: !!input.config?.api_key,
            api_pos_configured: !!input.config?.api_pos,
            payment_captured: isPaymentCaptured,
            is_order_modified,
        }),
    }
    const nextActionType: InvoiceDocumentType = (!pre.exists || pre.estado === "A") ? "PRE" : "FAC"

    return {
        correlation_id: correlationId,
        order_id: input.order_id,
        payment_status: order.payment_status || null,
        is_payment_captured: isPaymentCaptured,
        is_order_modified,
        config: {
            api_key_configured: !!input.config?.api_key,
            api_pos_configured: !!input.config?.api_pos,
            auto_invoice_enabled: !!input.config?.auto_invoice_enabled,
            test_mode: !!input.config?.invoice_test_mode,
        },
        documents: {
            PRE: pre,
            FAC: fac,
        },
        actions,
        next_action: actions[nextActionType],
    }
}

export async function loadInvoiceOrder(
    query: InvoiceQueryService,
    orderId: string
): Promise<InvoiceOrderGraph | null> {
    const { data } = await query.graph<InvoiceOrderGraph>({
        entity: "order",
        fields: [...ORDER_INVOICE_GRAPH_FIELDS],
        filters: { id: orderId },
    })

    return data[0] || null
}

// ── Private ──────────────────────────────────────────────

async function resolveOrderInvoiceDocumentSummary(input: {
    service: ContificoModuleService
    config: InvoiceConfig | null
    client: Awaited<ReturnType<typeof createClient>> | null
    order: InvoiceOrderGraph
    tipo_documento: InvoiceDocumentType
    correlation_id: string
}): Promise<InvoiceDocumentSummary> {
    const localMap = await findInvoiceMapForOrder(
        input.service,
        input.order.id,
        input.tipo_documento
    )

    if (localMap) {
        return hydrateInvoiceDocumentSummary(
            input.service,
            localMap,
            input.client,
            input.correlation_id
        )
    }

    if (!input.config || !input.client || input.config.invoice_test_mode) {
        return emptyInvoiceDocumentSummary()
    }

    let remoteDocument = null as import("../types").ContificoDocumento | null

    try {
        remoteDocument = await findRemoteDocumentByReference({
            client: input.client,
            config: input.config,
            order: input.order,
            tipo_documento: input.tipo_documento,
        })
    } catch {
        remoteDocument = null
    }

    if (!remoteDocument || remoteDocument.estado === "A") {
        return emptyInvoiceDocumentSummary()
    }

    await persistInvoiceMapForOrder({
        service: input.service,
        order_id: input.order.id,
        tipo_documento: input.tipo_documento,
        config: input.config,
        documento: remoteDocument,
        referencia: remoteDocument.referencia || null,
        correlation_id: input.correlation_id,
        auto: false,
    })

    let estadoElectronico: string | null = null
    if (!input.config.invoice_test_mode && input.tipo_documento === "FAC") {
        const estadoRes = await input.client.getDocumentoEstado(remoteDocument.id).catch(() => null)
        estadoElectronico = estadoRes?.estado || null
    }

    return {
        exists: true,
        source: "remote_linked",
        contifico_id: remoteDocument.id,
        referencia: remoteDocument.referencia || null,
        estado: remoteDocument.estado || null,
        total: remoteDocument.total || null,
        documento: remoteDocument.documento || null,
        url_ride: remoteDocument.url_ride || null,
        url_xml: remoteDocument.url_xml || null,
        created_at: remoteDocument.fecha_creacion || null,
        client_name: extractDocumentClientName(remoteDocument),
        client_identification: extractDocumentClientIdentification(remoteDocument),
        is_test: !!input.config.invoice_test_mode,
        estado_electronico: estadoElectronico,
    }
}

async function hydrateInvoiceDocumentSummary(
    service: ContificoModuleService,
    entry: Awaited<ReturnType<typeof findInvoiceMapForOrder>>,
    client: Awaited<ReturnType<typeof createClient>> | null,
    correlationId: string
): Promise<InvoiceDocumentSummary> {
    if (!entry) {
        return emptyInvoiceDocumentSummary()
    }

    const metadata = getInvoiceMetadata(entry.metadata)
    const remote = client ? await client.getDocumento(entry.contifico_id).catch(() => null) : null
    const state = remote?.estado || metadata.estado || null
    let estadoElectronico: string | null = null

    if (remote) {
        if (client && !metadata.test && remote.tipo_documento === "FAC") {
            const estadoRes = await client.getDocumentoEstado(remote.id).catch(() => null)
            estadoElectronico = estadoRes?.estado || null
        }
        const nextMetadata = buildInvoiceMapMetadata({
            ...metadata,
            referencia: remote.referencia || metadata.referencia || null,
            estado: remote.estado || metadata.estado || null,
            total: remote.total || metadata.total || null,
            documento: remote.documento || metadata.documento || null,
            url_ride: remote.url_ride || metadata.url_ride || null,
            url_xml: remote.url_xml || metadata.url_xml || null,
            created_at: remote.fecha_creacion || metadata.created_at || null,
            client_name: extractDocumentClientName(remote) || metadata.client_name || null,
            client_identification:
                extractDocumentClientIdentification(remote) ||
                metadata.client_identification ||
                null,
            correlation_id: correlationId,
        })

        if (JSON.stringify(nextMetadata || {}) !== JSON.stringify(entry.metadata || {})) {
            await service.updateContificoEntityMaps({
                id: entry.id,
                metadata: nextMetadata,
            })
        }
    }

    return {
        exists: state !== "A",
        source: "local",
        contifico_id: entry.contifico_id,
        referencia: remote?.referencia || metadata.referencia || null,
        estado: state,
        total: remote?.total || metadata.total || null,
        documento: remote?.documento || metadata.documento || null,
        url_ride: remote?.url_ride || metadata.url_ride || null,
        url_xml: remote?.url_xml || metadata.url_xml || null,
        created_at: remote?.fecha_creacion || metadata.created_at || null,
        client_name: extractDocumentClientName(remote) || metadata.client_name || null,
        client_identification:
            extractDocumentClientIdentification(remote) ||
            metadata.client_identification ||
            null,
        is_test: metadata.test === true || isTestRef(metadata.referencia),
        estado_electronico: estadoElectronico,
    }
}

function buildInvoiceDocumentActionState(
    tipoDocumento: InvoiceDocumentType,
    document: InvoiceDocumentSummary,
    context: {
        api_key_configured: boolean
        api_pos_configured: boolean
        payment_captured: boolean
        is_order_modified: boolean
    }
): InvoiceDocumentActionState {
    let label =
        tipoDocumento === "FAC" ? "Realizar factura" : "Generar prefactura"

    if (!context.api_key_configured) {
        return {
            tipo_documento: tipoDocumento,
            label,
            disabled: true,
            reason: "Configura la API Key de Contifico",
        }
    }

    if (!context.api_pos_configured) {
        return {
            tipo_documento: tipoDocumento,
            label,
            disabled: true,
            reason: "Configura el API POS para crear documentos",
        }
    }

    if (document.exists) {
        if (tipoDocumento === "PRE" && document.estado !== "A" && document.estado !== "G" && context.is_order_modified) {
            return {
                tipo_documento: tipoDocumento,
                label: "Actualizar",
                disabled: false,
                reason: "La orden ha sido modificada, actualiza la prefactura",
            }
        }
        return {
            tipo_documento: tipoDocumento,
            label,
            disabled: true,
            reason:
                tipoDocumento === "FAC"
                    ? "La factura ya fue creada"
                    : "La prefactura ya fue creada",
        }
    }

    if (tipoDocumento === "FAC" && !context.payment_captured) {
        return {
            tipo_documento: tipoDocumento,
            label,
            disabled: false,
            reason: "El pago no figura como capturado, pero puedes generar la factura manualmente",
        }
    }

    return {
        tipo_documento: tipoDocumento,
        label,
        disabled: false,
        reason: null,
    }
}
