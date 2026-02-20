import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
    Container,
    Heading,
    Button,
    Text,
    Label,
    Input,
    Switch,
    Checkbox,
    Badge,
    Table,
    Toaster,
    toast,
} from "@medusajs/ui"
import { useState, useEffect, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────

interface ContificoConfigData {
    id: string
    api_key: string
    api_pos: string | null
    bodega_ids: string[]
    sync_products_enabled: boolean
    sync_customers_enabled: boolean
    auto_invoice_enabled: boolean
    sync_interval_minutes: number
    manage_inventory: boolean
    allow_backorder: boolean
    sales_channel_id: string | null
    shipping_profile_id: string | null
    invoice_test_mode: boolean
    last_product_sync: string | null
    last_customer_sync: string | null
}

interface InvoiceEntry {
    id: string
    medusa_order_id: string
    contifico_doc_id: string
    is_test: boolean
    referencia: string | null
    tipo_documento: string | null
    estado: string | null
    total: string | null
    created_at: string
}

interface Bodega {
    id: string
    nombre: string
}

interface SyncLog {
    id: string
    sync_type: string
    status: string
    total_processed: number
    total_errors: number
    duration_ms: number
    started_at: string
    created_at: string
}

// ── Component ──────────────────────────────────────────────

const ContificoSettingsPage = () => {
    const [config, setConfig] = useState<ContificoConfigData | null>(null)
    const [bodegas, setBodegas] = useState<Bodega[]>([])
    const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [isTesting, setIsTesting] = useState(false)
    const [isLoadingBodegas, setIsLoadingBodegas] = useState(false)
    const [isSyncingProducts, setIsSyncingProducts] = useState(false)
    const [isSyncingCustomers, setIsSyncingCustomers] = useState(false)
    const [isDeletingProducts, setIsDeletingProducts] = useState(false)
    const [syncProgress, setSyncProgress] = useState<{ phase: string; message: string; percent: number } | null>(null)
    const [deleteProgress, setDeleteProgress] = useState<{ phase: string; message: string; percent: number } | null>(null)

    // Invoice state
    const [invoiceTestMode, setInvoiceTestMode] = useState(false)
    const [invoices, setInvoices] = useState<InvoiceEntry[]>([])
    const [isCreatingTestPRE, setIsCreatingTestPRE] = useState(false)
    const [isCreatingTestFAC, setIsCreatingTestFAC] = useState(false)
    const [isDeletingTestDocs, setIsDeletingTestDocs] = useState(false)

    // Form state
    const [apiKey, setApiKey] = useState("")
    const [apiPos, setApiPos] = useState("")
    const [bodegaIds, setBodegaIds] = useState<string[]>([])
    const [syncProducts, setSyncProducts] = useState(false)
    const [syncCustomers, setSyncCustomers] = useState(false)
    const [autoInvoice, setAutoInvoice] = useState(false)
    const [syncInterval, setSyncInterval] = useState(60)
    const [manageInventory, setManageInventory] = useState(false)
    const [allowBackorder, setAllowBackorder] = useState(false)
    const [salesChannelId, setSalesChannelId] = useState<string>("")
    const [shippingProfileId, setShippingProfileId] = useState<string>("")
    const [variantMode, setVariantMode] = useState<string>("auto")
    const [salesChannels, setSalesChannels] = useState<Array<{ id: string; name: string }>>([])
    const [shippingProfiles, setShippingProfiles] = useState<Array<{ id: string; name: string; type: string }>>([])

    // Helper: lee stream NDJSON y actualiza progreso, retorna el resultado final
    const readNDJSONStream = async (
        response: Response,
        onProgress: (p: { phase: string; message: string; percent: number }) => void
    ): Promise<any> => {
        // Si la respuesta es JSON normal (middleware interceptó), parsear directo
        const contentType = response.headers.get("content-type") || ""
        if (contentType.includes("application/json")) {
            return await response.json()
        }

        const reader = response.body?.getReader()
        if (!reader) {
            // Fallback: leer todo como texto y parsear líneas
            const text = await response.text()
            const lines = text.split("\n").filter(Boolean)
            let result: any = null
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line)
                    if (msg.type === "progress") onProgress(msg)
                    else if (msg.type === "result") result = msg.data
                    else if (!msg.type) result = msg // JSON plano
                } catch { /* skip */ }
            }
            return result
        }

        const decoder = new TextDecoder()
        let buffer = ""
        let result: any = null

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop()! // keep partial line

            for (const line of lines) {
                if (!line.trim()) continue
                try {
                    const msg = JSON.parse(line)
                    if (msg.type === "progress") {
                        onProgress(msg)
                    } else if (msg.type === "result") {
                        result = msg.data
                    } else if (!msg.type) {
                        result = msg // JSON plano sin wrapper
                    }
                } catch {
                    // malformed line, skip
                }
            }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
            try {
                const msg = JSON.parse(buffer)
                if (msg.type === "result") result = msg.data
                else if (!msg.type) result = msg
            } catch { /* ignore */ }
        }

        return result
    }

    const fetchConfig = useCallback(async () => {
        try {
            const res = await fetch("/admin/contifico/config", {
                credentials: "include",
            })
            const data = await res.json()
            if (data.config) {
                setConfig(data.config)
                setApiKey(data.config.api_key || "")
                setApiPos(data.config.api_pos || "")
                setBodegaIds(data.config.bodega_ids || [])
                setSyncProducts(data.config.sync_products_enabled)
                setSyncCustomers(data.config.sync_customers_enabled)
                setAutoInvoice(data.config.auto_invoice_enabled)
                setSyncInterval(data.config.sync_interval_minutes)
                setManageInventory(data.config.manage_inventory ?? false)
                setAllowBackorder(data.config.allow_backorder ?? false)
                setSalesChannelId(data.config.sales_channel_id || "")
                setShippingProfileId(data.config.shipping_profile_id || "")
                setVariantMode(data.config.variant_mode || "auto")
                setInvoiceTestMode(data.config.invoice_test_mode ?? false)
            }
        } catch (err) {
            console.error("Error cargando configuracion:", err)
        } finally {
            setIsLoading(false)
        }
    }, [])

    const fetchBodegas = useCallback(async () => {
        setIsLoadingBodegas(true)
        try {
            const res = await fetch("/admin/contifico/config/bodegas", {
                credentials: "include",
            })
            const data = await res.json()
            if (data.bodegas) {
                setBodegas(data.bodegas)
            }
        } catch (err) {
            console.error("Error cargando bodegas:", err)
        } finally {
            setIsLoadingBodegas(false)
        }
    }, [])

    const fetchSyncLogs = useCallback(async () => {
        try {
            const res = await fetch("/admin/contifico/sync-logs?limit=10", {
                credentials: "include",
            })
            const data = await res.json()
            if (data.sync_logs) {
                setSyncLogs(data.sync_logs)
            }
        } catch (err) {
            console.error("Error cargando logs:", err)
        }
    }, [])

    const fetchMedusaOptions = useCallback(async () => {
        try {
            const [scRes, spRes] = await Promise.all([
                fetch("/admin/sales-channels", { credentials: "include" }),
                fetch("/admin/shipping-profiles", { credentials: "include" }),
            ])
            const scData = await scRes.json()
            const spData = await spRes.json()
            const scList = scData.sales_channels || []
            const spList = spData.shipping_profiles || []
            setSalesChannels(scList)
            setShippingProfiles(spList)
            // Auto-seleccionar el primero si no hay selección guardada
            setSalesChannelId((prev) => prev || scList[0]?.id || "")
            setShippingProfileId((prev) => prev || spList[0]?.id || "")
        } catch (err) {
            console.error("Error cargando opciones de Medusa:", err)
        }
    }, [])

    const fetchInvoices = useCallback(async () => {
        try {
            const res = await fetch("/admin/contifico/invoices", {
                credentials: "include",
            })
            const data = await res.json()
            if (data.invoices) {
                setInvoices(data.invoices)
            }
        } catch (err) {
            console.error("Error cargando facturas:", err)
        }
    }, [])

    useEffect(() => {
        fetchConfig()
        fetchSyncLogs()
        fetchMedusaOptions()
        fetchInvoices()
    }, [fetchConfig, fetchSyncLogs])

    // Cargar bodegas cuando hay api_key
    useEffect(() => {
        if (apiKey) {
            fetchBodegas()
        }
    }, [config?.api_key])

    const handleSave = async () => {
        setIsSaving(true)
        try {
            const res = await fetch("/admin/contifico/config", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    api_key: apiKey,
                    api_pos: apiPos || null,
                    bodega_ids: bodegaIds,
                    sync_products_enabled: syncProducts,
                    sync_customers_enabled: syncCustomers,
                    auto_invoice_enabled: autoInvoice,
                    sync_interval_minutes: syncInterval,
                    manage_inventory: manageInventory,
                    allow_backorder: allowBackorder,
                    sales_channel_id: salesChannelId || null,
                    shipping_profile_id: shippingProfileId || null,
                    variant_mode: variantMode,
                    invoice_test_mode: invoiceTestMode,
                }),
            })

            if (!res.ok) {
                const err = await res.json()
                toast.error("Error", {
                    description: err.error?.formErrors?.join(", ") || err.error || "Error guardando",
                })
                return
            }

            const data = await res.json()
            setConfig(data.config)
            toast.success("Guardado", {
                description: "Configuracion de Contifico actualizada",
            })

            // Recargar bodegas si se cambio la API key
            fetchBodegas()
        } catch (err) {
            toast.error("Error", {
                description: (err as Error).message,
            })
        } finally {
            setIsSaving(false)
        }
    }

    const handleTestConnection = async () => {
        setIsTesting(true)
        try {
            const res = await fetch("/admin/contifico/config/check-connection", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ api_key: apiKey || undefined }),
            })

            const data = await res.json()

            if (data.ok) {
                toast.success("Conexion exitosa", {
                    description: data.message,
                })
            } else {
                toast.error("Error de conexion", {
                    description: data.error,
                })
            }
        } catch (err) {
            toast.error("Error", {
                description: (err as Error).message,
            })
        } finally {
            setIsTesting(false)
        }
    }

    if (isLoading) {
        return (
            <Container className="p-8">
                <Text>Cargando configuracion...</Text>
            </Container>
        )
    }

    return (
        <>
            <Toaster />
            <Container className="p-8">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <Heading level="h1">Contifico</Heading>
                        <Text className="text-ui-fg-subtle mt-1">
                            Configuracion de la integracion con Contifico ERP
                        </Text>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            onClick={handleTestConnection}
                            disabled={!apiKey || isTesting}
                            isLoading={isTesting}
                        >
                            Probar Conexion
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={!apiKey || isSaving}
                            isLoading={isSaving}
                        >
                            Guardar
                        </Button>
                    </div>
                </div>

                {/* Credenciales */}
                <Container className="mb-6 p-6">
                    <Heading level="h2" className="mb-4">
                        Credenciales API
                    </Heading>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="api_key">API Key *</Label>
                            <Input
                                id="api_key"
                                type="password"
                                placeholder="Tu API Key de Contifico"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label htmlFor="api_pos">
                                API POS{" "}
                                <span className="text-ui-fg-subtle">(para facturacion)</span>
                            </Label>
                            <Input
                                id="api_pos"
                                placeholder="Codigo POS para documentos"
                                value={apiPos}
                                onChange={(e) => setApiPos(e.target.value)}
                            />
                        </div>
                    </div>
                </Container>

                {/* Bodega */}
                <Container className="mb-6 p-6">
                    <Heading level="h2" className="mb-4">
                        Bodegas para Stock
                    </Heading>
                    <Text className="text-ui-fg-subtle text-sm mb-4">
                        Selecciona las bodegas de las que se sumara el stock disponible para la tienda web.
                    </Text>
                    <div className="max-w-md">
                        {isLoadingBodegas ? (
                            <Text className="text-ui-fg-subtle">Cargando bodegas...</Text>
                        ) : bodegas.length > 0 ? (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        onClick={() => setBodegaIds(bodegas.map((b) => b.id))}
                                    >
                                        Todas
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        onClick={() => setBodegaIds([])}
                                    >
                                        Ninguna
                                    </Button>
                                    <Badge color={bodegaIds.length > 0 ? "green" : "grey"}>
                                        {bodegaIds.length} de {bodegas.length}
                                    </Badge>
                                </div>
                                {bodegas.map((b) => (
                                    <label
                                        key={b.id}
                                        className="flex items-center gap-3 p-2 rounded hover:bg-ui-bg-base-hover cursor-pointer"
                                    >
                                        <Checkbox
                                            checked={bodegaIds.includes(b.id)}
                                            onCheckedChange={(checked) => {
                                                if (checked) {
                                                    setBodegaIds((prev) => [...prev, b.id])
                                                } else {
                                                    setBodegaIds((prev) =>
                                                        prev.filter((id) => id !== b.id)
                                                    )
                                                }
                                            }}
                                        />
                                        <Text weight="plus">{b.nombre}</Text>
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <Text className="text-ui-fg-subtle">
                                {apiKey
                                    ? "No se encontraron bodegas. Verifica la conexion."
                                    : "Ingresa la API Key primero."}
                            </Text>
                        )}
                    </div>
                </Container>

                {/* Opciones de productos sincronizados */}
                <Container className="mb-6 p-6">
                    <Heading level="h2" className="mb-2">
                        Opciones de Productos
                    </Heading>
                    <Text className="text-ui-fg-subtle text-sm mb-4">
                        Estas opciones se aplican a los productos creados durante la sincronización.
                    </Text>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Text weight="plus">Gestionar inventario</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Habilita el control de inventario en las variantes importadas.
                                    Si está activo, Medusa restará stock al crear pedidos.
                                </Text>
                            </div>
                            <Switch
                                checked={manageInventory}
                                onCheckedChange={setManageInventory}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <Text weight="plus">Permitir pedidos pendientes</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Permite comprar variantes sin stock disponible (backorder).
                                </Text>
                            </div>
                            <Switch
                                checked={allowBackorder}
                                onCheckedChange={setAllowBackorder}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <Text weight="plus">Modo de variantes</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Cómo se crean las variantes al importar productos de Contifico.
                                </Text>
                            </div>
                            <select
                                title="Modo de variantes"
                                value={variantMode}
                                onChange={(e) => setVariantMode(e.target.value)}
                                className="rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm text-ui-fg-base"
                            >
                                <option value="auto">Automático</option>
                                <option value="contifico">Variantes de Contifico</option>
                                <option value="simple">Variante única (PVP1)</option>
                            </select>
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <Text weight="plus">Canal de ventas</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Canal de ventas asignado a los productos sincronizados.
                                </Text>
                            </div>
                            <select
                                title="Canal de ventas"
                                value={salesChannelId}
                                onChange={(e) => setSalesChannelId(e.target.value)}
                                className="rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm text-ui-fg-base"
                            >
                                {salesChannels.map((sc) => (
                                    <option key={sc.id} value={sc.id}>{sc.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <Text weight="plus">Perfil de envío</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Perfil de envío asignado a los productos sincronizados.
                                </Text>
                            </div>
                            <select
                                title="Perfil de envío"
                                value={shippingProfileId}
                                onChange={(e) => setShippingProfileId(e.target.value)}
                                className="rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm text-ui-fg-base"
                            >
                                {shippingProfiles.map((sp) => (
                                    <option key={sp.id} value={sp.id}>{sp.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </Container>

                {/* Facturacion */}
                <Container className="mb-6 p-6">
                    <Heading level="h2" className="mb-2">
                        Facturación
                    </Heading>
                    <Text className="text-ui-fg-subtle text-sm mb-4">
                        Gestiona la creación de prefacturas y facturas en Contifico.
                    </Text>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Text weight="plus">Modo de prueba</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Genera documentos con referencia MEDUSA-TEST-* y cliente de prueba.
                                    Los documentos de prueba se pueden anular fácilmente.
                                </Text>
                            </div>
                            <Switch
                                checked={invoiceTestMode}
                                onCheckedChange={setInvoiceTestMode}
                            />
                        </div>

                        {invoiceTestMode && (
                            <div className="p-4 bg-ui-bg-subtle rounded-lg border border-ui-border-base space-y-3">
                                <div className="flex items-center gap-2">
                                    <Badge color="orange">MODO PRUEBA</Badge>
                                    <Text className="text-sm text-ui-fg-subtle">
                                        Los documentos auto-generados usan datos reales del cliente. Los manuales usan CONSUMIDOR FINAL PRUEBA.
                                    </Text>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        disabled={isCreatingTestPRE || isCreatingTestFAC || !apiPos}
                                        isLoading={isCreatingTestPRE}
                                        onClick={async () => {
                                            setIsCreatingTestPRE(true)
                                            try {
                                                const r = await fetch("/admin/contifico/invoices", {
                                                    method: "POST",
                                                    credentials: "include",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({ action: "create-test", tipo_documento: "PRE" }),
                                                })
                                                const d = await r.json()
                                                if (d.ok) {
                                                    toast.success("Prefactura de prueba creada", {
                                                        description: `Ref: ${d.documento.referencia}`,
                                                    })
                                                    fetchInvoices()
                                                } else {
                                                    toast.error("Error", { description: d.error })
                                                }
                                            } catch (e) {
                                                toast.error("Error", { description: (e as Error).message })
                                            } finally {
                                                setIsCreatingTestPRE(false)
                                            }
                                        }}
                                    >
                                        Crear Prefactura Test
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        disabled={isCreatingTestPRE || isCreatingTestFAC || !apiPos}
                                        isLoading={isCreatingTestFAC}
                                        onClick={async () => {
                                            setIsCreatingTestFAC(true)
                                            try {
                                                const r = await fetch("/admin/contifico/invoices", {
                                                    method: "POST",
                                                    credentials: "include",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({ action: "create-test", tipo_documento: "FAC" }),
                                                })
                                                const d = await r.json()
                                                if (d.ok) {
                                                    toast.success("Factura de prueba creada", {
                                                        description: `Ref: ${d.documento.referencia}`,
                                                    })
                                                    fetchInvoices()
                                                } else {
                                                    toast.error("Error", { description: d.error })
                                                }
                                            } catch (e) {
                                                toast.error("Error", { description: (e as Error).message })
                                            } finally {
                                                setIsCreatingTestFAC(false)
                                            }
                                        }}
                                    >
                                        Crear Factura Test
                                    </Button>
                                    <Button
                                        variant="danger"
                                        size="small"
                                        disabled={isDeletingTestDocs || invoices.filter(i => i.is_test && i.estado !== "A").length === 0}
                                        isLoading={isDeletingTestDocs}
                                        onClick={async () => {
                                            if (!confirm("¿Anular TODOS los documentos de prueba en Contifico?")) return
                                            setIsDeletingTestDocs(true)
                                            try {
                                                const r = await fetch("/admin/contifico/invoices", {
                                                    method: "POST",
                                                    credentials: "include",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({ action: "delete-tests" }),
                                                })
                                                const d = await r.json()
                                                if (d.ok) {
                                                    toast.success("Pruebas anuladas", {
                                                        description: d.message,
                                                    })
                                                    fetchInvoices()
                                                    fetchSyncLogs()
                                                } else {
                                                    toast.error("Error", { description: d.error || d.message })
                                                }
                                            } catch (e) {
                                                toast.error("Error", { description: (e as Error).message })
                                            } finally {
                                                setIsDeletingTestDocs(false)
                                            }
                                        }}
                                    >
                                        Anular pruebas ({invoices.filter(i => i.is_test && i.estado !== "A").length})
                                    </Button>
                                </div>
                                {!apiPos && (
                                    <Text className="text-ui-fg-destructive text-xs">
                                        Configura el API POS arriba para poder crear documentos
                                    </Text>
                                )}
                            </div>
                        )}

                        {/* Tabla de documentos creados */}
                        {invoices.length > 0 && (
                            <div className="mt-4">
                                <Text weight="plus" className="mb-2">Documentos creados</Text>
                                <Table>
                                    <Table.Header>
                                        <Table.Row>
                                            <Table.HeaderCell>Tipo</Table.HeaderCell>
                                            <Table.HeaderCell>Referencia</Table.HeaderCell>
                                            <Table.HeaderCell>Estado</Table.HeaderCell>
                                            <Table.HeaderCell>Total</Table.HeaderCell>
                                            <Table.HeaderCell>Fecha</Table.HeaderCell>
                                        </Table.Row>
                                    </Table.Header>
                                    <Table.Body>
                                        {invoices.map((inv) => (
                                            <Table.Row key={inv.id}>
                                                <Table.Cell>
                                                    <div className="flex items-center gap-1">
                                                        <Badge color={inv.tipo_documento === "FAC" ? "blue" : "purple"}>
                                                            {inv.tipo_documento || "?"}
                                                        </Badge>
                                                        {inv.is_test && (
                                                            <Badge color="orange" className="text-xs">TEST</Badge>
                                                        )}
                                                    </div>
                                                </Table.Cell>
                                                <Table.Cell>
                                                    <Text className="text-sm font-mono">
                                                        {inv.referencia || "-"}
                                                    </Text>
                                                </Table.Cell>
                                                <Table.Cell>
                                                    <Badge
                                                        color={
                                                            inv.estado === "A" ? "red"
                                                                : inv.estado === "C" ? "green"
                                                                    : "grey"
                                                        }
                                                    >
                                                        {inv.estado === "A" ? "Anulado"
                                                            : inv.estado === "C" ? "Cobrado"
                                                                : inv.estado === "P" ? "Pendiente"
                                                                    : inv.estado || "?"}
                                                    </Badge>
                                                </Table.Cell>
                                                <Table.Cell>${parseFloat(inv.total || "0").toFixed(2)}</Table.Cell>
                                                <Table.Cell>
                                                    {new Date(inv.created_at).toLocaleString()}
                                                </Table.Cell>
                                            </Table.Row>
                                        ))}
                                    </Table.Body>
                                </Table>
                            </div>
                        )}
                    </div>
                </Container>

                {/* Sincronizacion */}
                <Container className="mb-6 p-6">
                    <Heading level="h2" className="mb-4">
                        Sincronizacion
                    </Heading>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Text weight="plus">Sincronizar Productos y Stock</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Importa productos y actualiza inventario desde Contifico
                                </Text>
                            </div>
                            <div className="flex items-center gap-2">
                                {syncProducts && (
                                    <>
                                        <Button
                                            variant="danger"
                                            size="small"
                                            onClick={async () => {
                                                if (!confirm("¿Eliminar TODOS los productos importados de Contifico? Esta acción no se puede deshacer.")) return
                                                setIsDeletingProducts(true)
                                                setDeleteProgress({ phase: "init", message: "Iniciando...", percent: 0 })
                                                try {
                                                    const r = await fetch("/admin/contifico/sync/products/delete", {
                                                        method: "POST",
                                                        credentials: "include",
                                                    })
                                                    const d = await readNDJSONStream(r, (p) => setDeleteProgress(p))
                                                    console.log("[contifico] delete products response:", JSON.stringify(d, null, 2))
                                                    if (!d) {
                                                        toast.error("Error", { description: "No se recibió respuesta del servidor" })
                                                    } else if (d.error && !d.deleted) {
                                                        toast.error("Error", { description: d.error })
                                                    } else {
                                                        toast.success("Productos eliminados", {
                                                            description: d.message,
                                                        })
                                                        fetchSyncLogs()
                                                    }
                                                } catch (e) {
                                                    toast.error("Error", { description: (e as Error).message })
                                                } finally {
                                                    setIsDeletingProducts(false)
                                                    setDeleteProgress(null)
                                                }
                                            }}
                                            disabled={isDeletingProducts || isSyncingProducts}
                                            isLoading={isDeletingProducts}
                                        >
                                            Eliminar importados
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="small"
                                            onClick={async () => {
                                                setIsSyncingProducts(true)
                                                setSyncProgress({ phase: "init", message: "Iniciando sincronización...", percent: 0 })
                                                try {
                                                    const r = await fetch("/admin/contifico/sync/products", {
                                                        method: "POST",
                                                        credentials: "include",
                                                    })
                                                    const d = await readNDJSONStream(r, (p) => setSyncProgress(p))
                                                    console.log("[contifico] sync products response:", JSON.stringify(d, null, 2))
                                                    if (d?.error) {
                                                        toast.error("Error", { description: d.error })
                                                    } else if (d) {
                                                        toast.success("Sync completado", {
                                                            description: d.message || "Productos sincronizados",
                                                        })
                                                        if (d.stock_warnings?.length > 0) {
                                                            const count = d.stock_warnings.length
                                                            const ejemplos = d.stock_warnings
                                                                .slice(0, 3)
                                                                .map((w: any) => `${w.codigo}: bodega=${w.suma_bodegas} vs total=${w.cantidad_stock}`)
                                                                .join("\n")
                                                            toast.warning(`${count} producto(s) con stock diferente entre /stock y cantidad_stock`, {
                                                                description: `Se usó cantidad_stock (total) para estos productos.\n${ejemplos}`,
                                                                duration: 15000,
                                                            })
                                                        }
                                                        fetchSyncLogs()
                                                    }
                                                } catch (e) {
                                                    toast.error("Error", { description: (e as Error).message })
                                                } finally {
                                                    setIsSyncingProducts(false)
                                                    setSyncProgress(null)
                                                }
                                            }}
                                            disabled={isSyncingProducts}
                                            isLoading={isSyncingProducts}
                                        >
                                            Actualizar
                                        </Button>
                                    </>
                                )}
                                <Switch
                                    checked={syncProducts}
                                    onCheckedChange={setSyncProducts}
                                />
                            </div>
                        </div>

                        {/* Barra de progreso - Sync productos */}
                        {syncProgress && (
                            <div className="p-3 bg-ui-bg-subtle rounded-lg border border-ui-border-base">
                                <div className="flex items-center justify-between mb-2">
                                    <Text className="text-sm font-medium text-ui-fg-base">
                                        {syncProgress.message}
                                    </Text>
                                    <Badge color="blue" className="text-xs">
                                        {syncProgress.percent}%
                                    </Badge>
                                </div>
                                <div className="w-full bg-ui-bg-base rounded-full h-2 overflow-hidden">
                                    <div
                                        className="h-2 rounded-full transition-all duration-500 ease-out"
                                        style={{
                                            width: `${syncProgress.percent}%`,
                                            backgroundColor: syncProgress.percent >= 100 ? "#10b981" : "#3b82f6",
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Barra de progreso - Delete productos */}
                        {deleteProgress && (
                            <div className="p-3 bg-ui-bg-subtle rounded-lg border border-ui-border-base">
                                <div className="flex items-center justify-between mb-2">
                                    <Text className="text-sm font-medium text-ui-fg-base">
                                        {deleteProgress.message}
                                    </Text>
                                    <Badge color="red" className="text-xs">
                                        {deleteProgress.percent}%
                                    </Badge>
                                </div>
                                <div className="w-full bg-ui-bg-base rounded-full h-2 overflow-hidden">
                                    <div
                                        className="h-2 rounded-full transition-all duration-500 ease-out"
                                        style={{
                                            width: `${deleteProgress.percent}%`,
                                            backgroundColor: deleteProgress.percent >= 100 ? "#10b981" : "#ef4444",
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-between">
                            <div>
                                <Text weight="plus">Sincronizar Clientes</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Sincroniza clientes entre Medusa y Contifico
                                </Text>
                            </div>
                            <div className="flex items-center gap-2">
                                {syncCustomers && (
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        onClick={async () => {
                                            setIsSyncingCustomers(true)
                                            try {
                                                const r = await fetch("/admin/contifico/sync/customers", {
                                                    method: "POST",
                                                    credentials: "include",
                                                })
                                                const d = await r.json()
                                                if (d.error) {
                                                    toast.error("Error", { description: d.error })
                                                } else {
                                                    toast.success("Sync completado", {
                                                        description: d.message || "Clientes sincronizados",
                                                    })
                                                    fetchSyncLogs()
                                                }
                                            } catch (e) {
                                                toast.error("Error", { description: (e as Error).message })
                                            } finally {
                                                setIsSyncingCustomers(false)
                                            }
                                        }}
                                        disabled={isSyncingCustomers}
                                        isLoading={isSyncingCustomers}
                                    >
                                        Actualizar
                                    </Button>
                                )}
                                <Switch
                                    checked={syncCustomers}
                                    onCheckedChange={setSyncCustomers}
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <Text weight="plus">Facturacion Automatica</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Crea facturas en Contifico al completar pagos
                                </Text>
                                <Text className="text-ui-fg-destructive text-xs mt-1">
                                    Requiere API POS configurado
                                </Text>
                            </div>
                            <Switch
                                checked={autoInvoice}
                                onCheckedChange={setAutoInvoice}
                                disabled={!apiPos}
                            />
                        </div>

                        <div className="max-w-xs">
                            <Label htmlFor="sync_interval">
                                Intervalo de sincronizacion (minutos)
                            </Label>
                            <Input
                                id="sync_interval"
                                type="number"
                                min={5}
                                max={1440}
                                value={syncInterval}
                                onChange={(e) => setSyncInterval(Number(e.target.value))}
                            />
                        </div>
                    </div>
                </Container>

                {/* Ultimo sync */}
                {config && (config.last_product_sync || config.last_customer_sync) && (
                    <Container className="mb-6 p-6">
                        <Heading level="h2" className="mb-4">
                            Estado
                        </Heading>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Ultimo sync productos
                                </Text>
                                <Text>
                                    {config.last_product_sync
                                        ? new Date(config.last_product_sync).toLocaleString()
                                        : "Nunca"}
                                </Text>
                            </div>
                            <div>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Ultimo sync clientes
                                </Text>
                                <Text>
                                    {config.last_customer_sync
                                        ? new Date(config.last_customer_sync).toLocaleString()
                                        : "Nunca"}
                                </Text>
                            </div>
                        </div>
                    </Container>
                )}

                {/* Logs de sincronizacion */}
                {syncLogs.length > 0 && (
                    <Container className="p-6">
                        <Heading level="h2" className="mb-4">
                            Historial de Sincronizaciones
                        </Heading>
                        <Table>
                            <Table.Header>
                                <Table.Row>
                                    <Table.HeaderCell>Tipo</Table.HeaderCell>
                                    <Table.HeaderCell>Estado</Table.HeaderCell>
                                    <Table.HeaderCell>Procesados</Table.HeaderCell>
                                    <Table.HeaderCell>Errores</Table.HeaderCell>
                                    <Table.HeaderCell>Duracion</Table.HeaderCell>
                                    <Table.HeaderCell>Fecha</Table.HeaderCell>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {syncLogs.map((log) => (
                                    <Table.Row key={log.id}>
                                        <Table.Cell>
                                            <Badge>{log.sync_type}</Badge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Badge
                                                color={
                                                    log.status === "success"
                                                        ? "green"
                                                        : log.status === "partial"
                                                            ? "orange"
                                                            : "red"
                                                }
                                            >
                                                {log.status}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell>{log.total_processed}</Table.Cell>
                                        <Table.Cell>{log.total_errors}</Table.Cell>
                                        <Table.Cell>{(log.duration_ms / 1000).toFixed(1)}s</Table.Cell>
                                        <Table.Cell>
                                            {new Date(log.created_at).toLocaleString()}
                                        </Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table>
                    </Container>
                )}
            </Container>
        </>
    )
}

export const config = defineRouteConfig({
    label: "Contifico",
})

export default ContificoSettingsPage
