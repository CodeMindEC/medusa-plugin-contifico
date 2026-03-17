/**
 * Invoice entity map persistence and deduplication logic.
 * Handles finding, creating, and updating invoice entity maps,
 * plus remote document lookup for idempotency.
 */

import { buildInvoiceMapMetadata } from "../contifico-metadata"
import { isUniqueConstraintError, logContificoEvent } from "../observability"
import type { ContificoDocumento } from "../types"
import type ContificoModuleService from "../../modules/contifico/service"
import {
    createClient,
    getInvoiceMetadata,
    type InvoiceConfig,
    type InvoiceOrderGraph,
} from "../../api/admin/contifico/invoices/shared"
import { buildOrderInvoiceReference } from "./invoice-payload"
import {
    ACTIVE_INVOICE_MAP_CONFLICT_ERROR,
    REMOTE_DOCUMENT_SEARCH_MAX_PAGES,
    REMOTE_DOCUMENT_SEARCH_PAGE_SIZE,
    REMOTE_DOCUMENT_SEARCH_WINDOW_DAYS,
    extractDocumentClientIdentification,
    extractDocumentClientName,
    formatContificoDate,
    daysAgo,
    normalizeReference,
} from "./invoice-documents-utils"

type InvoiceDocumentType = "PRE" | "FAC"

interface FindRemoteDocumentByReferenceInput {
    client: Awaited<ReturnType<typeof createClient>>
    config: InvoiceConfig
    order: InvoiceOrderGraph
    tipo_documento: InvoiceDocumentType
}

interface PersistInvoiceMapInput {
    service: ContificoModuleService
    order_id: string
    tipo_documento: InvoiceDocumentType
    config: Pick<InvoiceConfig, "invoice_test_mode">
    documento: ContificoDocumento
    referencia?: string | null
    correlation_id: string
    auto: boolean
}

// ── Public ───────────────────────────────────────────────

export async function findActiveInvoiceMapForOrder(
    service: ContificoModuleService,
    orderId: string,
    tipoDocumento: InvoiceDocumentType
) {
    const entry = await findInvoiceMapForOrder(service, orderId, tipoDocumento)
    if (!entry) {
        return null
    }

    const metadata = getInvoiceMetadata(entry.metadata)
    return metadata.estado === "A" ? null : entry
}

export function buildInvoiceEntityMapKey(
    orderId: string,
    tipoDocumento: InvoiceDocumentType,
    isTest: boolean
): string {
    return `${isTest ? "test:" : ""}${orderId}:${tipoDocumento}`
}

export async function findInvoiceMapForOrder(
    service: ContificoModuleService,
    orderId: string,
    tipoDocumento: InvoiceDocumentType
) {
    const invoiceMaps = await service.listContificoEntityMaps(
        { entity_type: "invoice" },
        { take: 500 }
    )

    return invoiceMaps.find((entry) => {
        const metadata = getInvoiceMetadata(entry.metadata)
        const mapBelongsToOrder =
            metadata.order_id === orderId ||
            entry.medusa_id === orderId ||
            entry.medusa_id === buildInvoiceEntityMapKey(orderId, tipoDocumento, false) ||
            entry.medusa_id === buildInvoiceEntityMapKey(orderId, tipoDocumento, true)

        return mapBelongsToOrder && metadata.tipo_documento === tipoDocumento
    })
}

export async function persistInvoiceMapForOrder(
    input: PersistInvoiceMapInput
) {
    const existing = await findInvoiceMapForOrder(
        input.service,
        input.order_id,
        input.tipo_documento
    )
    const metadata = buildInvoiceMapMetadata({
        ...getInvoiceMetadata(existing?.metadata),
        referencia: input.documento.referencia || input.referencia || null,
        tipo_documento: input.tipo_documento,
        estado: input.documento.estado || null,
        total: input.documento.total || null,
        order_id: input.order_id,
        documento: input.documento.documento || null,
        url_ride: input.documento.url_ride || null,
        url_xml: input.documento.url_xml || null,
        created_at: input.documento.fecha_creacion || null,
        client_name: extractDocumentClientName(input.documento),
        client_identification: extractDocumentClientIdentification(input.documento),
        test: input.config.invoice_test_mode,
        auto: input.auto,
        correlation_id: input.correlation_id,
    })

    if (existing) {
        const existingMetadata = getInvoiceMetadata(existing.metadata)
        const isSameDocument = existing.contifico_id === input.documento.id
        const isCancelled = existingMetadata.estado === "A"

        if (!isSameDocument && !isCancelled) {
            throw new Error(ACTIVE_INVOICE_MAP_CONFLICT_ERROR)
        }

        await input.service.updateContificoEntityMaps({
            id: existing.id,
            medusa_id: buildInvoiceEntityMapKey(
                input.order_id,
                input.tipo_documento,
                input.config.invoice_test_mode
            ),
            contifico_id: input.documento.id,
            metadata,
        })
        return
    }

    try {
        await input.service.createContificoEntityMaps({
            entity_type: "invoice",
            medusa_id: buildInvoiceEntityMapKey(
                input.order_id,
                input.tipo_documento,
                input.config.invoice_test_mode
            ),
            contifico_id: input.documento.id,
            metadata,
        })
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            const current = await findInvoiceMapForOrder(
                input.service,
                input.order_id,
                input.tipo_documento
            )
            if (current) {
                await input.service.updateContificoEntityMaps({
                    id: current.id,
                    medusa_id: buildInvoiceEntityMapKey(
                        input.order_id,
                        input.tipo_documento,
                        input.config.invoice_test_mode
                    ),
                    contifico_id: input.documento.id,
                    metadata,
                })
                return
            }
        }

        throw error
    }
}

export async function findRemoteDocumentByReference(
    input: FindRemoteDocumentByReferenceInput
): Promise<ContificoDocumento | null> {
    const reference = buildOrderInvoiceReference(input.order, input.config)
    if (!reference) {
        return null
    }

    const paramsBase = {
        tipo: input.tipo_documento,
        tipo_registro: "CLI",
        fecha_inicial: formatContificoDate(daysAgo(REMOTE_DOCUMENT_SEARCH_WINDOW_DAYS)),
        fecha_final: formatContificoDate(new Date()),
        result_size: String(REMOTE_DOCUMENT_SEARCH_PAGE_SIZE),
    }

    for (let page = 1; page <= REMOTE_DOCUMENT_SEARCH_MAX_PAGES; page++) {
        const response = await input.client.getDocumentos({
            ...paramsBase,
            result_page: String(page),
        })

        const match = response.results.find((documento) => {
            return (
                documento.tipo_documento === input.tipo_documento &&
                normalizeReference(documento.referencia) === normalizeReference(reference) &&
                documento.estado !== "A"
            )
        })

        if (match) {
            return match
        }

        if (!response.next || response.results.length < REMOTE_DOCUMENT_SEARCH_PAGE_SIZE) {
            break
        }
    }

    return null
}

export async function safelyCancelDuplicateRemoteDocumento(
    client: Awaited<ReturnType<typeof createClient>>,
    contificoId: string,
    context: Record<string, unknown>
) {
    try {
        await client.anularDocumento(contificoId)
        logContificoEvent("warn", "Duplicate remote invoice cancelled", {
            correlation_id: String(context.correlation_id || "unknown"),
            operation: "invoice.cancel_duplicate_remote",
            contifico_id: contificoId,
        })
    } catch (error) {
        logContificoEvent(
            "error",
            "Failed to cancel duplicate remote invoice",
            {
                correlation_id: String(context.correlation_id || "unknown"),
                operation: "invoice.cancel_duplicate_remote",
                contifico_id: contificoId,
            },
            error
        )
    }
}
