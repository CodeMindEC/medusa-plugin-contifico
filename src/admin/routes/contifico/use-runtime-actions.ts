import { toast } from "@medusajs/ui"
import { useCallback } from "react"
import { getErrorDescription, parseJsonResponse } from "./controller-helpers"
import type {
    DeleteSyncActionResult,
    ProductSyncActionResult,
} from "./types"

interface UseRuntimeActionsParams {
    apiKey: string
    fetchInvoices: () => Promise<void>
    fetchSyncLogs: () => Promise<void>
    invoicePreviewOrderId: string
    invoicePreviewType: "PRE" | "FAC"
    setDeletePreview: (value: string | null) => void
    setDeleteProgress: (value: {
        phase: string
        message: string
        percent: number
    } | null) => void
    setInvoicePreview: (value: string | null) => void
    setIsCreatingTestFAC: (value: boolean) => void
    setIsCreatingTestPRE: (value: boolean) => void
    setIsDeletingProducts: (value: boolean) => void
    setIsDeletingTestDocs: (value: boolean) => void
    setIsPreviewingDelete: (value: boolean) => void
    setIsPreviewingInvoice: (value: boolean) => void
    setIsPreviewingSync: (value: boolean) => void
    setIsSyncingCustomers: (value: boolean) => void
    setIsSyncingProducts: (value: boolean) => void
    setIsSyncingStock: (value: boolean) => void
    setIsTesting: (value: boolean) => void
    setSyncPreview: (value: string | null) => void
    setSyncProgress: (value: {
        phase: string
        message: string
        percent: number
    } | null) => void
}

export function useRuntimeActions({
    apiKey,
    fetchInvoices,
    fetchSyncLogs,
    invoicePreviewOrderId,
    invoicePreviewType,
    setDeletePreview,
    setDeleteProgress,
    setInvoicePreview,
    setIsCreatingTestFAC,
    setIsCreatingTestPRE,
    setIsDeletingProducts,
    setIsDeletingTestDocs,
    setIsPreviewingDelete,
    setIsPreviewingInvoice,
    setIsPreviewingSync,
    setIsSyncingCustomers,
    setIsSyncingProducts,
    setIsSyncingStock,
    setIsTesting,
    setSyncPreview,
    setSyncProgress,
}: UseRuntimeActionsParams) {
    const runPreview = useCallback(
        async (
            url: string,
            setter: (value: string) => void,
            setLoading: (value: boolean) => void,
            body?: Record<string, unknown>
        ) => {
            setLoading(true)
            try {
                const response = await fetch(url, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body || {}),
                })
                const data = await parseJsonResponse<Record<string, unknown>>(response)
                setter(JSON.stringify(data, null, 2))
                if (!response.ok || data.ok === false) {
                    toast.warning("Preview con bloqueos", {
                        description:
                            (Array.isArray(data.blockers)
                                ? data.blockers.join(", ")
                                : undefined) ||
                            (typeof data.error === "string" ? data.error : undefined) ||
                            "La simulación devolvió advertencias.",
                    })
                    return
                }
                toast.success("Preview generado", {
                    description: "La simulación se ejecutó sin mutar datos.",
                })
            } catch (error) {
                toast.error("Error", {
                    description: getErrorDescription(error),
                })
            } finally {
                setLoading(false)
            }
        },
        []
    )

    const handleTestConnection = useCallback(async () => {
        setIsTesting(true)
        try {
            const response = await fetch("/admin/contifico/config/check-connection", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ api_key: apiKey || undefined }),
            })
            const data = await parseJsonResponse<{
                ok?: boolean
                message?: string
                error?: string
            }>(response)

            if (data.ok) {
                toast.success("Conexion exitosa", {
                    description: data.message,
                })
                return
            }

            toast.error("Error de conexion", {
                description: data.error || "No se pudo conectar con Contífico.",
            })
        } catch (error) {
            toast.error("Error", {
                description: getErrorDescription(error),
            })
        } finally {
            setIsTesting(false)
        }
    }, [apiKey, setIsTesting])

    const createTestInvoice = useCallback(
        async (type: "PRE" | "FAC") => {
            const setLoading =
                type === "PRE" ? setIsCreatingTestPRE : setIsCreatingTestFAC

            setLoading(true)
            try {
                const response = await fetch("/admin/contifico/invoices", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "create-test",
                        tipo_documento: type,
                    }),
                })
                const data = await parseJsonResponse<{
                    ok?: boolean
                    error?: string
                    documento?: { referencia?: string }
                }>(response)

                if (data.ok) {
                    toast.success(
                        type === "PRE"
                            ? "Prefactura de prueba creada"
                            : "Factura de prueba creada",
                        {
                            description: `Ref: ${data.documento?.referencia || "-"}`,
                        }
                    )
                    fetchInvoices()
                    return
                }

                toast.error("Error", {
                    description: data.error || "No se pudo crear el documento de prueba.",
                })
            } catch (error) {
                toast.error("Error", {
                    description: getErrorDescription(error),
                })
            } finally {
                setLoading(false)
            }
        },
        [fetchInvoices, setIsCreatingTestFAC, setIsCreatingTestPRE]
    )

    const deleteTestInvoices = useCallback(async () => {
        if (!window.confirm("¿Anular TODOS los documentos de prueba en Contifico?")) {
            return
        }

        setIsDeletingTestDocs(true)
        try {
            const response = await fetch("/admin/contifico/invoices", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "delete-tests" }),
            })
            const data = await parseJsonResponse<{
                ok?: boolean
                error?: string
                message?: string
            }>(response)

            if (data.ok) {
                toast.success("Pruebas anuladas", {
                    description: data.message,
                })
                fetchInvoices()
                fetchSyncLogs()
                return
            }

            toast.error("Error", {
                description: data.error || data.message || "No se pudieron anular.",
            })
        } catch (error) {
            toast.error("Error", {
                description: getErrorDescription(error),
            })
        } finally {
            setIsDeletingTestDocs(false)
        }
    }, [fetchInvoices, fetchSyncLogs, setIsDeletingTestDocs])

    const previewInvoicePayload = useCallback(() => {
        if (!invoicePreviewOrderId) {
            return
        }

        return runPreview(
            "/admin/contifico/invoices/preview",
            (value) => setInvoicePreview(value),
            setIsPreviewingInvoice,
            {
                order_id: invoicePreviewOrderId,
                tipo_documento: invoicePreviewType,
            }
        )
    }, [
        invoicePreviewOrderId,
        invoicePreviewType,
        runPreview,
        setInvoicePreview,
        setIsPreviewingInvoice,
    ])

    const previewDeleteSync = useCallback(() => {
        return runPreview(
            "/admin/contifico/sync/products/delete/preview",
            (value) => setDeletePreview(value),
            setIsPreviewingDelete
        )
    }, [runPreview, setDeletePreview, setIsPreviewingDelete])

    const previewProductSync = useCallback(() => {
        return runPreview(
            "/admin/contifico/sync/products/preview",
            (value) => setSyncPreview(value),
            setIsPreviewingSync
        )
    }, [runPreview, setIsPreviewingSync, setSyncPreview])

    const runDeleteProducts = useCallback(async () => {
        if (
            !window.confirm(
                "¿Desincronizar TODOS los productos vinculados a Contifico y eliminar los creados por el plugin? Esta acción no se puede deshacer."
            )
        ) {
            return
        }

        setIsDeletingProducts(true)
        try {
            const response = await fetch("/admin/contifico/sync/products/delete", {
                method: "POST",
                credentials: "include",
            })
            const data = await parseJsonResponse<DeleteSyncActionResult>(response)
            if (!response.ok || data.error) {
                toast.error("Error", { description: data.error || "No se pudo encolar la limpieza." })
                return
            }

            toast.success("Limpieza encolada", {
                description: `Run ${data.log_id || "pendiente"} en estado ${data.status || "queued"}.`,
            })
            fetchSyncLogs()
        } catch (error) {
            toast.error("Error", {
                description: getErrorDescription(error),
            })
        } finally {
            setIsDeletingProducts(false)
            setDeleteProgress(null)
        }
    }, [fetchSyncLogs, setDeleteProgress, setIsDeletingProducts])

    const runProductSync = useCallback(async () => {
        setIsSyncingProducts(true)

        try {
            const response = await fetch("/admin/contifico/sync/products", {
                method: "POST",
                credentials: "include",
            })
            const data = await parseJsonResponse<ProductSyncActionResult>(response)

            if (!response.ok || data?.error) {
                toast.error("Error", { description: data?.error || "No se pudo encolar el sync." })
                return
            }

            toast.success("Sync encolado", {
                description: `Run ${data.log_id || "pendiente"} en estado ${data.status || "queued"}.`,
            })
            fetchSyncLogs()
        } catch (error) {
            toast.error("Error", {
                description: getErrorDescription(error),
            })
        } finally {
            setIsSyncingProducts(false)
            setSyncProgress(null)
        }
    }, [fetchSyncLogs, setIsSyncingProducts, setSyncProgress])

    const runProductStockSync = useCallback(async () => {
        setIsSyncingStock(true)

        try {
            const response = await fetch("/admin/contifico/sync/products/stock", {
                method: "POST",
                credentials: "include",
            })
            const data = await parseJsonResponse<ProductSyncActionResult>(response)

            if (!response.ok || data?.error) {
                toast.error("Error", {
                    description: data?.error || "No se pudo encolar el sync de stock.",
                })
                return
            }

            toast.success("Sync de stock encolado", {
                description: `Run ${data.log_id || "pendiente"} en estado ${data.status || "queued"}.`,
            })
            fetchSyncLogs()
        } catch (error) {
            toast.error("Error", {
                description: getErrorDescription(error),
            })
        } finally {
            setIsSyncingStock(false)
        }
    }, [fetchSyncLogs, setIsSyncingStock])

    const runCustomerSync = useCallback(async () => {
        setIsSyncingCustomers(true)
        try {
            const response = await fetch("/admin/contifico/sync/customers", {
                method: "POST",
                credentials: "include",
            })
            const data = await parseJsonResponse<{
                error?: string
                message?: string
            }>(response)
            if (data.error) {
                toast.error("Error", { description: data.error })
            } else {
                toast.success("Sync completado", {
                    description: data.message || "Clientes sincronizados",
                })
                fetchSyncLogs()
            }
        } catch (error) {
            toast.error("Error", {
                description: getErrorDescription(error),
            })
        } finally {
            setIsSyncingCustomers(false)
        }
    }, [fetchSyncLogs, setIsSyncingCustomers])

    return {
        createTestInvoice,
        deleteTestInvoices,
        handleTestConnection,
        previewDeleteSync,
        previewInvoicePayload,
        previewProductSync,
        runDeleteProducts,
        runProductSync,
        runProductStockSync,
        runCustomerSync,
    }
}
