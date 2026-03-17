import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type ContificoModuleService from "../../../../modules/contifico/service"
import {
    createOrderInvoiceDocument,
    createStandaloneTestInvoiceDocument,
    deleteTestInvoiceDocuments,
} from "../../../../lib/use-cases/invoice-documents"
import {
    createClient,
    getInvoiceMetadata,
    getRequiredInvoiceConfig,
    isTestRef,
    type InvoiceConfig,
} from "./shared"
import {
    CreateInvoiceSchema,
    CreateTestInvoiceSchema,
} from "./validators"

interface InvoiceQueryService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

export async function listInvoices(
    _req: MedusaRequest,
    res: MedusaResponse,
    service: ContificoModuleService
) {
    const invoiceMaps = await service.listContificoEntityMaps(
        { entity_type: "invoice" },
        { take: 500 }
    )

    const recentMaps = [...invoiceMaps]
        .sort(
            (left, right) =>
                new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
        )
        .slice(0, 100)

    const config = await getRequiredInvoiceConfig(service)
    const client = config ? await createClient(config) : null

    const invoices = await Promise.all(
        recentMaps.map(async (map) => {
            const metadata = getInvoiceMetadata(map.metadata)
            let contificoApiStatus: string | null = null
            let contificoSecuencial: string | null = null

            if (client) {
                try {
                    const document = await client.getDocumento(map.contifico_id)
                    contificoApiStatus = document.estado || null
                    contificoSecuencial = document.documento || null
                } catch {
                    // Keep local metadata when API status is unavailable.
                }
            }

            return {
                id: map.id,
                medusa_order_id: metadata.order_id || map.medusa_id,
                contifico_doc_id: map.contifico_id,
                is_test: isTestRef(metadata.referencia),
                referencia: metadata.referencia || null,
                tipo_documento: metadata.tipo_documento || null,
                estado: contificoApiStatus || metadata.estado || null,
                documento: contificoSecuencial || null,
                total: metadata.total ? String(metadata.total) : null,
                created_at: map.created_at,
            }
        })
    )

    res.json({
        invoices,
        test_mode: config?.invoice_test_mode ?? false,
    })
}

export async function createInvoice(
    req: MedusaRequest,
    res: MedusaResponse,
    service: ContificoModuleService,
    config: InvoiceConfig
) {
    const parsed = CreateInvoiceSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({
            error: parsed.error.issues.map((i) => i.message).join("; "),
        })
        return
    }

    const { order_id, tipo_documento } = parsed.data

    try {
        const query = req.scope.resolve("query") as InvoiceQueryService
        const result = await createOrderInvoiceDocument({
            service,
            query,
            config,
            order_id,
            tipo_documento,
            trigger: "manual",
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
                error: `Ya existe un documento activo ${tipo_documento} para esta orden`,
                existing: result.existing,
                correlation_id: result.correlation_id,
            })
            return
        }

        res.status(201).json({
            ok: true,
            correlation_id: result.correlation_id,
            documento: result.documento,
        })
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Error interno",
        })
    }
}

export async function createTestInvoice(
    req: MedusaRequest,
    res: MedusaResponse,
    service: ContificoModuleService,
    config: InvoiceConfig
) {
    if (!config.api_pos) {
        res.status(400).json({ error: "Configura el API POS para crear documentos" })
        return
    }
    if (!config.invoice_test_mode) {
        res.status(403).json({ error: "El modo de prueba no esta habilitado" })
        return
    }

    const parsed = CreateTestInvoiceSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({
            error: parsed.error.issues.map((i) => i.message).join("; "),
        })
        return
    }

    const { tipo_documento } = parsed.data

    try {
        const result = await createStandaloneTestInvoiceDocument({
            service,
            config,
            tipo_documento,
        })

        res.status(201).json({
            ok: true,
            correlation_id: result.correlation_id,
            documento: result.documento,
        })
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Error interno",
        })
    }
}

export async function deleteTestInvoices(
    res: MedusaResponse,
    service: ContificoModuleService,
    config: InvoiceConfig
) {
    if (!config.invoice_test_mode) {
        res.status(403).json({ error: "El modo de prueba no esta habilitado" })
        return
    }

    try {
        const result = await deleteTestInvoiceDocuments({
            service,
            config,
        })

        res.json({
            ok: result.errores === 0,
            correlation_id: result.correlation_id,
            anulados: result.anulados,
            errores: result.errores,
            message: `${result.anulados} documento(s) de prueba anulados${result.errores > 0 ? `, ${result.errores} errores` : ""}`,
            errors: result.errores > 0 ? result.errors : undefined,
        })
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Error interno",
        })
    }
}
