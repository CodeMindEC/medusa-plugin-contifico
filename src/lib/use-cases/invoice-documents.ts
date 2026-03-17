import { buildInvoiceMapMetadata } from "../contifico-metadata"
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
    isTestRef,
    logInvoiceSync,
    ORDER_INVOICE_GRAPH_FIELDS,
    type InvoiceConfig,
    type InvoiceOrderGraph,
} from "../../api/admin/contifico/invoices/shared"
import { buildOrderInvoiceReference } from "./invoice-payload"

const REMOTE_DOCUMENT_SEARCH_PAGE_SIZE = 100
const REMOTE_DOCUMENT_SEARCH_MAX_PAGES = 10
const REMOTE_DOCUMENT_SEARCH_WINDOW_DAYS = 365
const ACTIVE_INVOICE_MAP_CONFLICT_ERROR = "contifico_active_invoice_map_conflict"

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

export interface CreateStandaloneTestInvoiceInput {
    service: ContificoModuleService
    config: InvoiceConfig
    tipo_documento: InvoiceDocumentType
    correlation_id?: string
    clientFactory?: typeof createClient
    buildTestDocumento?: typeof createTestDocumentoPayload
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

export interface DeleteTestInvoicesInput {
    service: ContificoModuleService
    config: InvoiceConfig
    correlation_id?: string
    clientFactory?: typeof createClient
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

export async function createStandaloneTestInvoiceDocument(
    input: CreateStandaloneTestInvoiceInput
) {
    const correlationId =
        input.correlation_id || createCorrelationId("contifico_test_invoice")
    const clientFactory = input.clientFactory || createClient
    const buildTestDocumento = input.buildTestDocumento || createTestDocumentoPayload
    const payload = await buildTestDocumento(input.service, input.tipo_documento)
    const client = await clientFactory(input.config)
    const created = await client.createDocumento(payload)

    await input.service.createContificoEntityMaps({
        entity_type: "invoice",
        medusa_id: `test:${Date.now()}:${input.tipo_documento}`,
        contifico_id: created.id,
        metadata: buildInvoiceMapMetadata({
            referencia: payload.referencia,
            tipo_documento: input.tipo_documento,
            estado: created.estado,
            total: created.total,
            documento: created.documento || null,
            url_ride: created.url_ride || null,
            url_xml: created.url_xml || null,
            created_at: created.fecha_creacion || null,
            client_name: extractDocumentClientName(created),
            client_identification: extractDocumentClientIdentification(created),
            test: true,
            correlation_id: correlationId,
        }),
    })

    await logInvoiceSync(input.service, {
        status: "success",
        total_processed: 1,
        total_errors: 0,
        details: {
            correlation_id: correlationId,
            trigger: "manual-test",
            contifico_id: created.id,
            tipo_documento: input.tipo_documento,
            referencia: payload.referencia,
            test: true,
        },
    })

    logContificoEvent("info", "Standalone test invoice created", {
        correlation_id: correlationId,
        operation: "invoice.create_test_document",
        tipo_documento: input.tipo_documento,
        contifico_id: created.id,
    })

    return {
        correlation_id: correlationId,
        documento: serializeInvoiceDocument(
            created,
            input.tipo_documento,
            payload.referencia || "",
            true
        ),
    }
}

export async function deleteTestInvoiceDocuments(
    input: DeleteTestInvoicesInput
) {
    const correlationId =
        input.correlation_id || createCorrelationId("contifico_delete_test_invoices")
    const clientFactory = input.clientFactory || createClient
    const client = await clientFactory(input.config)
    const invoices = await input.service.listContificoEntityMaps(
        { entity_type: "invoice" },
        { take: 500 }
    )

    const testDocs = invoices.filter((invoice) => {
        const metadata = getInvoiceMetadata(invoice.metadata)
        return metadata.test === true || isTestRef(metadata.referencia)
    })

    if (testDocs.length === 0) {
        return {
            correlation_id: correlationId,
            anulados: 0,
            errores: 0,
            errors: [] as string[],
        }
    }

    let anulados = 0
    const errors: string[] = []

    for (const invoice of testDocs) {
        try {
            const remote = await client.getDocumento(invoice.contifico_id).catch(() => null)
            if (remote?.estado === "A") {
                await input.service.updateContificoEntityMaps({
                    id: invoice.id,
                    metadata: buildInvoiceMapMetadata({
                        ...getInvoiceMetadata(invoice.metadata),
                        estado: "A",
                        correlation_id: correlationId,
                    }),
                })
                continue
            }

            await client.anularDocumento(invoice.contifico_id)
            await input.service.updateContificoEntityMaps({
                id: invoice.id,
                metadata: buildInvoiceMapMetadata({
                    ...getInvoiceMetadata(invoice.metadata),
                    estado: "A",
                    correlation_id: correlationId,
                }),
            })
            anulados++
        } catch (error) {
            errors.push(
                `${invoice.contifico_id}: ${getErrorMessage(
                    error,
                    "Error anulando"
                )}`
            )
        }
    }

    await logInvoiceSync(input.service, {
        status: errors.length > 0 ? "partial" : "success",
        total_processed: anulados,
        total_errors: errors.length,
        details: {
            correlation_id: correlationId,
            action: "delete-tests",
            errors,
        },
    })

    logContificoEvent(
        errors.length > 0 ? "warn" : "info",
        "Test invoices processed",
        {
            correlation_id: correlationId,
            operation: "invoice.delete_test_documents",
            anulados,
            errores: errors.length,
        }
    )

    return {
        correlation_id: correlationId,
        anulados,
        errores: errors.length,
        errors,
    }
}

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

    let remoteDocument: ContificoDocumento | null = null

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

async function findRemoteDocumentByReference(
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

async function persistInvoiceMapForOrder(
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

async function findInvoiceMapForOrder(
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

function serializeInvoiceDocument(
    documento: ContificoDocumento,
    tipoDocumento: InvoiceDocumentType,
    referencia: string,
    isTest: boolean
) {
    return {
        id: documento.id,
        tipo_documento: tipoDocumento,
        referencia,
        estado: documento.estado,
        total: documento.total,
        documento: documento.documento || null,
        url_ride: documento.url_ride || null,
        url_xml: documento.url_xml || null,
        created_at: documento.fecha_creacion || null,
        client_name: extractDocumentClientName(documento),
        client_identification: extractDocumentClientIdentification(documento),
        test: isTest,
    }
}

function emptyInvoiceDocumentSummary(): InvoiceDocumentSummary {
    return {
        exists: false,
        source: "none",
        contifico_id: null,
        referencia: null,
        estado: null,
        total: null,
        documento: null,
        url_ride: null,
        url_xml: null,
        created_at: null,
        client_name: null,
        client_identification: null,
        is_test: false,
        estado_electronico: null,
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

function formatContificoDate(date: Date): string {
    return `${String(date.getDate()).padStart(2, "0")}/${String(
        date.getMonth() + 1
    ).padStart(2, "0")}/${date.getFullYear()}`
}

function daysAgo(days: number) {
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date
}

function normalizeReference(reference: string | null | undefined): string {
    return String(reference || "").trim()
}

function isActiveInvoiceMapConflictError(error: unknown): boolean {
    return error instanceof Error && error.message === ACTIVE_INVOICE_MAP_CONFLICT_ERROR
}

function extractDocumentClientName(
    documento: Pick<ContificoDocumento, "cliente" | "persona"> | null | undefined
): string | null {
    return (
        documento?.cliente?.razon_social ||
        documento?.persona?.razon_social ||
        null
    )
}

function extractDocumentClientIdentification(
    documento: Pick<ContificoDocumento, "cliente" | "persona"> | null | undefined
): string | null {
    return (
        documento?.cliente?.cedula ||
        documento?.persona?.ruc ||
        documento?.persona?.cedula ||
        null
    )
}

async function safelyCancelDuplicateRemoteDocumento(
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
