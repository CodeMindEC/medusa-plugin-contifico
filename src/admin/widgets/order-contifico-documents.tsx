import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { useCallback, useEffect, useState } from "react"

type DocumentType = "PRE" | "FAC"

interface InvoiceDocumentSummary {
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

interface InvoiceDocumentActionState {
    tipo_documento: DocumentType
    label: string
    disabled: boolean
    reason: string | null
}

interface OrderDocumentStateResponse {
    correlation_id: string
    order_id: string
    payment_status: string | null
    is_payment_captured: boolean
    config: {
        api_key_configured: boolean
        api_pos_configured: boolean
        auto_invoice_enabled: boolean
        test_mode: boolean
    }
    documents: Record<DocumentType, InvoiceDocumentSummary>
    actions: Record<DocumentType, InvoiceDocumentActionState>
    next_action: {
        tipo_documento: DocumentType
        label: string
        disabled: boolean
        reason: string | null
    }
}

const DOCUMENT_LABELS: Record<DocumentType, string> = {
    PRE: "Prefactura",
    FAC: "Factura",
}

const OrderContificoDocumentsWidget = ({
    data: order,
}: DetailWidgetProps<AdminOrder>) => {
    const [state, setState] = useState<OrderDocumentStateResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchState = useCallback(async () => {
        try {
            setError(null)
            const res = await fetch(`/admin/orders/${order.id}/contifico-documents`, {
                credentials: "include",
            })

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}))
                throw new Error(payload.error || `Error ${res.status}`)
            }

            const payload = (await res.json()) as OrderDocumentStateResponse
            setState(payload)
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "No se pudo cargar el estado de Contifico"
            setError(message)
        } finally {
            setLoading(false)
        }
    }, [order.id])

    useEffect(() => {
        void fetchState()
    }, [fetchState])

    const handleCreate = async (type: DocumentType, action: "create" | "update" = "create") => {
        if (!state) {
            return
        }

        setSubmitting(true)
        setError(null)

        try {
            const res = await fetch(`/admin/orders/${order.id}/contifico-documents`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    tipo_documento: type,
                    action,
                }),
            })

            const payload = await res.json().catch(() => ({}))
            if (!res.ok) {
                throw new Error(payload.error || `Error ${res.status}`)
            }

            const actionName = type === "FAC" ? "Factura" : "Prefactura"
            const message = action === "update"
                ? `${actionName} actualizada en Contifico`
                : payload.status === "linked"
                    ? `${actionName} vinculada desde Contifico`
                    : `${actionName} creada en Contifico`
            toast.success(message)
            await fetchState()
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "No se pudo crear el documento"
            setError(message)
            toast.error(message)
        } finally {
            setSubmitting(false)
        }
    }

    if (loading) {
        return (
            <Container className="p-4">
                <Text size="small" className="text-ui-fg-subtle">
                    Cargando estado de Contifico...
                </Text>
            </Container>
        )
    }

    if (!state) {
        return (
            <Container className="p-4 space-y-2">
                <Text size="small" className="text-ui-fg-error">
                    {error || "No se pudo cargar la información de Contifico."}
                </Text>
                <Button variant="secondary" size="small" onClick={() => void fetchState()}>
                    Reintentar
                </Button>
            </Container>
        )
    }

    return (
        <Container className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
                <div>
                    <Heading level="h2">Documentos Contifico</Heading>
                    <Text size="small" className="text-ui-fg-subtle">
                        Control manual de prefactura y factura para esta orden
                    </Text>
                </div>
                <div className="flex items-center gap-2">
                    {state.config.test_mode ? <Badge color="orange">Modo prueba</Badge> : null}
                    {state.is_payment_captured ? (
                        <Badge color="green">Pago capturado</Badge>
                    ) : (
                        <Badge color="blue">Pago no capturado</Badge>
                    )}
                </div>
            </div>

            <div className="space-y-4 px-6 py-4">
                {(["PRE", "FAC"] as DocumentType[]).map((type) => {
                    const document = state.documents[type]
                    const badgeColor = document.exists
                        ? "green"
                        : document.estado === "A"
                          ? "red"
                          : "grey"
                    const badgeLabel = document.exists
                        ? document.source === "remote_linked"
                            ? "Vinculada"
                            : "Disponible"
                        : document.estado === "A"
                          ? "Anulada"
                          : "Pendiente"

                    return (
                        <div
                            key={type}
                            className="rounded-lg border border-ui-border-base p-4"
                        >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Text weight="plus">{DOCUMENT_LABELS[type]}</Text>
                                        <Badge color={badgeColor}>{badgeLabel}</Badge>
                                    </div>
                                    <Text size="small" className="text-ui-fg-subtle">
                                        ID Contifico: {document.contifico_id || "Sin vinculo"}
                                    </Text>
                                    <Text size="small" className="text-ui-fg-subtle">
                                        {document.documento
                                            ? `Documento: ${document.documento}`
                                            : "Sin numero de documento vinculado"}
                                    </Text>
                                    <Text size="small" className="text-ui-fg-subtle">
                                        {document.referencia
                                            ? `Referencia: ${document.referencia}`
                                            : "Sin referencia registrada"}
                                    </Text>
                                    {document.estado && document.estado !== "A" ? (
                                        <Text size="small" className="text-ui-fg-subtle">
                                            Estado Contifico: {document.estado}
                                        </Text>
                                    ) : null}
                                    {type === "FAC" && document.exists && !document.is_test && document.estado_electronico ? (
                                        <Text size="small" className="text-ui-fg-subtle">
                                            Estado SRI: {document.estado_electronico}
                                        </Text>
                                    ) : null}
                                    {type === "FAC" && document.exists && document.is_test ? (
                                        <Text size="small" className="text-ui-fg-subtle font-medium">
                                            Estado SRI: <Badge color="red" size="small">SIN AUTORIZACION</Badge>
                                        </Text>
                                    ) : null}
                                    <Text size="small" className="text-ui-fg-subtle">
                                        Fecha de creacion:{" "}
                                        {document.created_at || "No disponible"}
                                    </Text>
                                    <Text size="small" className="text-ui-fg-subtle">
                                        Cliente: {document.client_name || "No disponible"}
                                    </Text>
                                    <Text size="small" className="text-ui-fg-subtle">
                                        Cedula/RUC:{" "}
                                        {document.client_identification || "No disponible"}
                                    </Text>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    {document.url_ride ? (
                                        <a
                                            href={document.url_ride}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-ui-fg-interactive text-sm underline"
                                        >
                                            Abrir RIDE
                                        </a>
                                    ) : null}
                                    {document.url_xml ? (
                                        <a
                                            href={document.url_xml}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-ui-fg-interactive text-sm underline"
                                        >
                                            Abrir XML
                                        </a>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    )
                })}

                <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <Text weight="plus">{state.next_action.label}</Text>
                            <Text size="small" className="text-ui-fg-subtle">
                                {state.next_action.tipo_documento === "FAC"
                                    ? "Puedes generar la factura directamente a Contifico."
                                    : "Puedes generar una prefactura para revision antes del pago."}
                            </Text>
                            {state.next_action.reason ? (
                                <Text size="small" className="mt-1 text-ui-fg-subtle">
                                    {state.next_action.reason}
                                </Text>
                            ) : null}
                        </div>

                        <Button
                            size="small"
                            onClick={() => void handleCreate(state.next_action.tipo_documento, state.next_action.label === "Actualizar" ? "update" : "create")}
                            disabled={state.next_action.disabled || submitting}
                            isLoading={submitting}
                        >
                            {state.next_action.label}
                        </Button>
                    </div>
                </div>

                {error ? (
                    <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3">
                        <Text size="small" className="text-ui-fg-error">
                            {error}
                        </Text>
                    </div>
                ) : null}
            </div>
        </Container>
    )
}

export const config = defineWidgetConfig({
    zone: "order.details.side.before",
})

export default OrderContificoDocumentsWidget
