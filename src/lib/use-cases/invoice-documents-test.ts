/**
 * Test invoice operations: create standalone test documents
 * and delete/cancel all test documents.
 */

import { buildInvoiceMapMetadata } from "../contifico-metadata"
import {
    createCorrelationId,
    getErrorMessage,
    logContificoEvent,
} from "../observability"
import type ContificoModuleService from "../../modules/contifico/service"
import {
    createClient,
    createTestDocumentoPayload,
    getInvoiceMetadata,
    isTestRef,
    logInvoiceSync,
    type InvoiceConfig,
} from "../../api/admin/contifico/invoices/shared"
import {
    extractDocumentClientIdentification,
    extractDocumentClientName,
    serializeInvoiceDocument,
} from "./invoice-documents-utils"

type InvoiceDocumentType = "PRE" | "FAC"

export interface CreateStandaloneTestInvoiceInput {
    service: ContificoModuleService
    config: InvoiceConfig
    tipo_documento: InvoiceDocumentType
    correlation_id?: string
    clientFactory?: typeof createClient
    buildTestDocumento?: typeof createTestDocumentoPayload
}

export interface DeleteTestInvoicesInput {
    service: ContificoModuleService
    config: InvoiceConfig
    correlation_id?: string
    clientFactory?: typeof createClient
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
