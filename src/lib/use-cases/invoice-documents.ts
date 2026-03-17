/**
 * Invoice documents — types, CRUD orchestration, and barrel re-exports.
 *
 * Split into sub-modules:
 * - invoice-documents-utils.ts  → shared helpers (serialize, format, extract)
 * - invoice-idempotency.ts      → entity map persistence & dedup
 * - invoice-documents-query.ts  → status queries & order loading
 * - invoice-documents-test.ts   → test invoice operations
 */

import {
    createCorrelationId,
    getErrorMessage,
    isUniqueConstraintError,
    logContificoEvent,
} from "../observability"
import type { ContificoDocumento, ContificoDocumentoCreate } from "../types"
import type ContificoModuleService from "../../modules/contifico/service"
import {
    buildDocumentoFromOrder,
    createClient,
    createTestDocumentoPayload,
    getInvoiceMetadata,
    logInvoiceSync,
    type InvoiceConfig,
    type InvoiceOrderGraph,
} from "../../api/admin/contifico/invoices/shared"
import {
    findActiveInvoiceMapForOrder,
    findRemoteDocumentByReference,
    persistInvoiceMapForOrder,
    safelyCancelDuplicateRemoteDocumento,
} from "./invoice-idempotency"
import {
    isActiveInvoiceMapConflictError,
    serializeInvoiceDocument,
} from "./invoice-documents-utils"
import { loadInvoiceOrder } from "./invoice-documents-query"

// ── Re-exports (backward compatibility) ──────────────────
export {
    getOrderInvoiceDocumentsStatus,
    loadInvoiceOrder,
} from "./invoice-documents-query"
export {
    createStandaloneTestInvoiceDocument,
    deleteTestInvoiceDocuments,
    type CreateStandaloneTestInvoiceInput,
    type DeleteTestInvoicesInput,
} from "./invoice-documents-test"
export {
    findActiveInvoiceMapForOrder,
    buildInvoiceEntityMapKey,
} from "./invoice-idempotency"

// ── Types ────────────────────────────────────────────────────

interface InvoiceQueryService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

type InvoiceDocumentType = "PRE" | "FAC"

export interface CreateOrderInvoiceDocumentInput {
    service: ContificoModuleService
    query: InvoiceQueryService
    config: InvoiceConfig
    order_id: string
    tipo_documento: InvoiceDocumentType
    trigger: string
    correlation_id?: string
    clientFactory?: typeof createClient
    buildDocumento?: typeof buildDocumentoFromOrder
}

export interface CreateOrderInvoiceDocumentResult {
    status: "created" | "linked" | "duplicate" | "not_found" | "blocked"
    correlation_id: string
    existing?: {
        contifico_id: string
        referencia: string | null | undefined
    }
    documento?: {
        id: string
        tipo_documento: InvoiceDocumentType
        referencia: string
        estado: string | null | undefined
        total: string | number | null | undefined
        documento?: string | null
        url_ride?: string | null
        url_xml?: string | null
        test: boolean
    }
    payload?: ContificoDocumentoCreate
    reason?: string
}

export interface UpdateOrderInvoiceDocumentInput {
    service: ContificoModuleService
    query: InvoiceQueryService
    config: InvoiceConfig
    order_id: string
    tipo_documento: InvoiceDocumentType
    trigger: string
    correlation_id?: string
    force_estado?: string
    clientFactory?: typeof createClient
    buildDocumento?: typeof buildDocumentoFromOrder
}

export interface UpdateOrderInvoiceDocumentResult {
    status: "updated" | "not_found" | "blocked" | "invalid_state"
    correlation_id: string
    documento?: {
        id: string
        tipo_documento: InvoiceDocumentType
        referencia: string
        estado: string | null | undefined
        total: string | number | null | undefined
        documento?: string | null
        url_ride?: string | null
        url_xml?: string | null
        test: boolean
    }
    payload?: ContificoDocumentoCreate
    reason?: string
}

export interface InvoiceDocumentSummary {
    exists: boolean
    source: "none" | "local" | "remote_linked"
    contifico_id: string | null
    referencia: string | null
    estado: string | null
    total: string | number | null
    documento: string | null
    url_ride: string | null
    url_xml: string | null
    created_at: string | null
    client_name: string | null
    client_identification: string | null
    is_test: boolean
    estado_electronico: string | null
}

export interface InvoiceDocumentActionState {
    tipo_documento: InvoiceDocumentType
    label: string
    disabled: boolean
    reason: string | null
}

export interface GetOrderInvoiceDocumentsStatusInput {
    service: ContificoModuleService
    query: InvoiceQueryService
    config: InvoiceConfig | null
    order_id: string
    correlation_id?: string
    clientFactory?: typeof createClient
}

export interface GetOrderInvoiceDocumentsStatusResult {
    correlation_id: string
    order_id: string
    payment_status: string | null
    is_payment_captured: boolean
    is_order_modified: boolean
    config: {
        api_key_configured: boolean
        api_pos_configured: boolean
        auto_invoice_enabled: boolean
        test_mode: boolean
    }
    documents: Record<InvoiceDocumentType, InvoiceDocumentSummary>
    actions: Record<InvoiceDocumentType, InvoiceDocumentActionState>
    next_action: {
        tipo_documento: InvoiceDocumentType
        label: string
        disabled: boolean
        reason: string | null
    }
}

// ── CRUD Orchestration ───────────────────────────────────

export async function createOrderInvoiceDocument(
    input: CreateOrderInvoiceDocumentInput
): Promise<CreateOrderInvoiceDocumentResult> {
    const correlationId =
        input.correlation_id || createCorrelationId("contifico_invoice")
    const logContext = {
        correlation_id: correlationId,
        operation: "invoice.create_order_document",
        trigger: input.trigger,
        order_id: input.order_id,
        tipo_documento: input.tipo_documento,
        test: input.config.invoice_test_mode,
    }

    if (!input.config.api_pos) {
        logContificoEvent("warn", "Invoice creation blocked: missing API POS", logContext)
        return {
            status: "blocked",
            correlation_id: correlationId,
            reason: "Configura el API POS para crear documentos",
        }
    }

    const existing = await findActiveInvoiceMapForOrder(
        input.service,
        input.order_id,
        input.tipo_documento
    )
    if (existing) {
        const existingMetadata = getInvoiceMetadata(existing.metadata)
        logContificoEvent("info", "Invoice creation skipped: active document already exists", {
            ...logContext,
            existing_contifico_id: existing.contifico_id,
        })
        return {
            status: "duplicate",
            correlation_id: correlationId,
            existing: {
                contifico_id: existing.contifico_id,
                referencia: existingMetadata.referencia,
            },
        }
    }

    const order = await loadInvoiceOrder(input.query, input.order_id)
    if (!order) {
        logContificoEvent("warn", "Invoice creation blocked: order not found", logContext)
        return {
            status: "not_found",
            correlation_id: correlationId,
            reason: `Orden ${input.order_id} no encontrada`,
        }
    }

    const buildDocumento = input.buildDocumento || buildDocumentoFromOrder
    const clientFactory = input.clientFactory || createClient
    const payload = await buildDocumento(
        order,
        input.tipo_documento,
        input.service,
        input.config
    )
    const client = await clientFactory(input.config)
    let remoteExisting: ContificoDocumento | null = null

    try {
        remoteExisting = await findRemoteDocumentByReference({
            client,
            config: input.config,
            order,
            tipo_documento: input.tipo_documento,
        })
    } catch (error) {
        logContificoEvent(
            "warn",
            "Remote invoice lookup failed before create; continuing with creation",
            logContext,
            error
        )
    }

    if (remoteExisting && remoteExisting.estado !== "A") {
        try {
            await persistInvoiceMapForOrder({
                service: input.service,
                order_id: input.order_id,
                tipo_documento: input.tipo_documento,
                config: input.config,
                documento: remoteExisting,
                referencia: payload.referencia,
                correlation_id: correlationId,
                auto: input.trigger !== "manual",
            })
        } catch (error) {
            if (isActiveInvoiceMapConflictError(error)) {
                const duplicate = await findActiveInvoiceMapForOrder(
                    input.service,
                    input.order_id,
                    input.tipo_documento
                )
                const duplicateMetadata = duplicate
                    ? getInvoiceMetadata(duplicate.metadata)
                    : null

                return {
                    status: "duplicate",
                    correlation_id: correlationId,
                    existing: duplicate
                        ? {
                            contifico_id: duplicate.contifico_id,
                            referencia: duplicateMetadata?.referencia,
                        }
                        : undefined,
                }
            }

            throw error
        }

        await logInvoiceSync(input.service, {
            status: "success",
            total_processed: 1,
            total_errors: 0,
            details: {
                correlation_id: correlationId,
                trigger: input.trigger,
                action: "link-existing",
                contifico_id: remoteExisting.id,
                tipo_documento: input.tipo_documento,
                referencia: remoteExisting.referencia || payload.referencia,
                test: input.config.invoice_test_mode,
                order_id: input.order_id,
            },
        })

        logContificoEvent("info", "Invoice linked to existing remote document", {
            ...logContext,
            contifico_id: remoteExisting.id,
            referencia: remoteExisting.referencia || payload.referencia,
        })

        return {
            status: "linked",
            correlation_id: correlationId,
            existing: {
                contifico_id: remoteExisting.id,
                referencia: remoteExisting.referencia || payload.referencia,
            },
            documento: serializeInvoiceDocument(
                remoteExisting,
                input.tipo_documento,
                payload.referencia || remoteExisting.referencia || "",
                input.config.invoice_test_mode
            ),
            payload,
        }
    }

    let created: ContificoDocumento | null = null

    try {
        created = await client.createDocumento(payload)

        await persistInvoiceMapForOrder({
            service: input.service,
            order_id: input.order_id,
            tipo_documento: input.tipo_documento,
            config: input.config,
            documento: created,
            referencia: payload.referencia,
            correlation_id: correlationId,
            auto: input.trigger !== "manual",
        })

        await logInvoiceSync(input.service, {
            status: "success",
            total_processed: 1,
            total_errors: 0,
            details: {
                correlation_id: correlationId,
                trigger: input.trigger,
                contifico_id: created.id,
                tipo_documento: input.tipo_documento,
                referencia: payload.referencia,
                test: input.config.invoice_test_mode,
                order_id: input.order_id,
            },
        })

        logContificoEvent("info", "Invoice created", {
            ...logContext,
            contifico_id: created.id,
            referencia: payload.referencia,
        })

        return {
            status: "created",
            correlation_id: correlationId,
            payload,
            documento: serializeInvoiceDocument(
                created,
                input.tipo_documento,
                payload.referencia || "",
                input.config.invoice_test_mode
            ),
        }
    } catch (error) {
        if (
            created &&
            (isUniqueConstraintError(error) || isActiveInvoiceMapConflictError(error))
        ) {
            await safelyCancelDuplicateRemoteDocumento(client, created.id, logContext)
            const duplicate = await findActiveInvoiceMapForOrder(
                input.service,
                input.order_id,
                input.tipo_documento
            )
            const duplicateMetadata = duplicate
                ? getInvoiceMetadata(duplicate.metadata)
                : null

            logContificoEvent(
                "warn",
                "Invoice creation deduplicated after local unique constraint",
                {
                    ...logContext,
                    remote_duplicate_contifico_id: created.id,
                    existing_contifico_id: duplicate?.contifico_id || null,
                }
            )

            return {
                status: "duplicate",
                correlation_id: correlationId,
                existing: duplicate
                    ? {
                        contifico_id: duplicate.contifico_id,
                        referencia: duplicateMetadata?.referencia,
                    }
                    : undefined,
            }
        }

        await logInvoiceSync(input.service, {
            status: "error",
            total_processed: 0,
            total_errors: 1,
            details: {
                correlation_id: correlationId,
                trigger: input.trigger,
                order_id: input.order_id,
                tipo_documento: input.tipo_documento,
                error: getErrorMessage(error, "Error creando documento"),
            },
        })

        logContificoEvent("error", "Invoice creation failed", logContext, error)
        throw error
    }
}

export async function updateOrderInvoiceDocument(
    input: UpdateOrderInvoiceDocumentInput
): Promise<UpdateOrderInvoiceDocumentResult> {
    const correlationId =
        input.correlation_id || createCorrelationId("contifico_invoice_update")
    const logContext = {
        correlation_id: correlationId,
        operation: "invoice.update_order_document",
        trigger: input.trigger,
        order_id: input.order_id,
        tipo_documento: input.tipo_documento,
        test: input.config.invoice_test_mode,
    }

    if (!input.config.api_pos) {
        logContificoEvent("warn", "Invoice update blocked: missing API POS", logContext)
        return {
            status: "blocked",
            correlation_id: correlationId,
            reason: "Configura el API POS para crear o actualizar documentos",
        }
    }

    const existing = await findActiveInvoiceMapForOrder(
        input.service,
        input.order_id,
        input.tipo_documento
    )

    if (!existing || !existing.contifico_id) {
        return {
            status: "not_found",
            correlation_id: correlationId,
            reason: `No hay documento ${input.tipo_documento} activo para la orden ${input.order_id}`,
        }
    }

    const order = await loadInvoiceOrder(input.query, input.order_id)
    if (!order) {
        return {
            status: "not_found",
            correlation_id: correlationId,
            reason: `Orden ${input.order_id} no encontrada`,
        }
    }

    const clientFactory = input.clientFactory || createClient
    const client = await clientFactory(input.config)

    // Validate current remote state
    let remoteExisting: ContificoDocumento | null = null
    try {
        remoteExisting = await client.getDocumento(existing.contifico_id)
    } catch (error) {
        logContificoEvent("warn", "Failed to get remote document for update", logContext, error)
        return {
            status: "not_found",
            correlation_id: correlationId,
            reason: "Documento remoto no encontrado o inaccesible",
        }
    }

    if (remoteExisting.estado === "A" || remoteExisting.estado === "G") {
        return {
            status: "invalid_state",
            correlation_id: correlationId,
            reason: `No se puede actualizar el documento porque está en estado ${remoteExisting.estado}`,
        }
    }

    const buildDocumento = input.buildDocumento || buildDocumentoFromOrder
    const payload = await buildDocumento(
        order,
        input.tipo_documento,
        input.service,
        input.config
    )

    // Force state if provided, otherwise default PRE to "P".
    if (input.force_estado) {
        payload.estado = input.force_estado
    } else if (input.tipo_documento === "PRE") {
        payload.estado = "P"
    }

    let updated: ContificoDocumento | null = null

    try {
        updated = await client.updateDocumento(existing.contifico_id, payload)

        await persistInvoiceMapForOrder({
            service: input.service,
            order_id: input.order_id,
            tipo_documento: input.tipo_documento,
            config: input.config,
            documento: updated,
            referencia: payload.referencia,
            correlation_id: correlationId,
            auto: input.trigger !== "manual",
        })

        await logInvoiceSync(input.service, {
            status: "success",
            total_processed: 1,
            total_errors: 0,
            details: {
                correlation_id: correlationId,
                trigger: input.trigger,
                action: "update",
                contifico_id: updated.id,
                tipo_documento: input.tipo_documento,
                referencia: payload.referencia,
                test: input.config.invoice_test_mode,
                order_id: input.order_id,
            },
        })

        logContificoEvent("info", "Invoice updated", {
            ...logContext,
            contifico_id: updated.id,
            referencia: payload.referencia,
        })

        return {
            status: "updated",
            correlation_id: correlationId,
            payload,
            documento: serializeInvoiceDocument(
                updated,
                input.tipo_documento,
                payload.referencia || "",
                input.config.invoice_test_mode
            ),
        }
    } catch (error) {
        await logInvoiceSync(input.service, {
            status: "error",
            total_processed: 0,
            total_errors: 1,
            details: {
                correlation_id: correlationId,
                trigger: input.trigger,
                action: "update",
                order_id: input.order_id,
                tipo_documento: input.tipo_documento,
                error: getErrorMessage(error, "Error actualizando documento"),
            },
        })

        logContificoEvent("error", "Invoice update failed", logContext, error)
        throw error
    }
}
