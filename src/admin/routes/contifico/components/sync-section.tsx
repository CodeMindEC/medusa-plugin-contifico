import {
    Badge,
    Button,
    Container,
    Heading,
    Input,
    Label,
    Switch,
    Text,
} from "@medusajs/ui"
import type { ContificoSettingsController } from "../state"
import { ProgressCard } from "./progress-card"
import { SyncLogsTable } from "./sync-logs-table"
import type { SyncLog } from "../types"

export function SyncSection({
    controller,
}: {
    controller: ContificoSettingsController
}) {
    const {
        autoInvoice,
        autoInvoiceGate,
        autoPreinvoice,
        config,
        deleteImportedProductsGate,
        deletePreview,
        deleteProgress,
        isDeletingProducts,
        isPreviewingDelete,
        isPreviewingSync,
        isSyncingCustomers,
        isSyncingProducts,
        isSyncingStock,
        productSyncActionsGate,
        previewDeleteSync,
        previewProductSync,
        runCustomerSync,
        runDeleteProducts,
        runProductSync,
        runProductStockSync,
        setAutoInvoice,
        setSyncCustomers,
        setSyncInterval,
        setSyncProducts,
        syncCustomers,
        syncInterval,
        syncIntervalGate,
        syncLogs,
        syncPreview,
        syncProducts,
        syncProgress,
    } = controller
    const activeSyncLogs = syncLogs.filter(
        (log) => log.status === "queued" || log.status === "running"
    )
    const hasSyncActivity =
        !!syncProgress ||
        !!deleteProgress ||
        activeSyncLogs.length > 0 ||
        !!syncPreview ||
        !!deletePreview

    return (
        <>
            <Container className="mb-6 p-6">
                <HeadingBlock />
                <div className="space-y-4">
                    <div className="rounded-xl border border-ui-border-base bg-ui-bg-subtle p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="max-w-3xl space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Text weight="plus">Productos y stock</Text>
                                    <Badge color={syncProducts ? "green" : "grey"}>
                                        {syncProducts ? "Activo" : "Inactivo"}
                                    </Badge>
                                    <Badge
                                        color={
                                            productSyncActionsGate.enabled
                                                ? "blue"
                                                : "grey"
                                        }
                                    >
                                        {productSyncActionsGate.enabled
                                            ? "Listo para ejecutar"
                                            : "Requiere configuracion"}
                                    </Badge>
                                </div>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Importa productos nuevos, actualiza los precios
                                    de los productos que siguen a Contífico y
                                    sincroniza inventario.
                                </Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Usa la previsualizacion antes de importar o limpiar
                                    para revisar el impacto de cada corrida.
                                </Text>
                                {syncProducts && (
                                    <Text className="text-ui-fg-subtle text-xs">
                                        La limpieza elimina productos creados por el
                                        plugin y desincroniza/restaura los productos
                                        Medusa ya existentes.
                                    </Text>
                                )}
                                {!productSyncActionsGate.enabled &&
                                    productSyncActionsGate.disabledReason && (
                                        <Text className="text-ui-fg-destructive text-xs">
                                            {productSyncActionsGate.disabledReason}
                                        </Text>
                                    )}
                            </div>
                            <div className="flex items-center gap-3 rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-3">
                                <div className="text-right">
                                    <Text weight="plus" className="text-sm">
                                        Sincronizacion habilitada
                                    </Text>
                                    <Text className="text-ui-fg-subtle text-xs">
                                        {syncProducts
                                            ? "Acciones manuales y automaticas disponibles."
                                            : "Activa este modulo para importar y mantener el catalogo."}
                                    </Text>
                                </div>
                                <Switch
                                    checked={syncProducts}
                                    onCheckedChange={setSyncProducts}
                                />
                            </div>
                        </div>

                        {syncProducts && (
                            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                                <div className="rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Text weight="plus">Operaciones principales</Text>
                                        <Badge color="blue">Catalogo</Badge>
                                    </div>
                                    <Text className="mt-1 text-ui-fg-subtle text-sm">
                                        Ejecuta la importacion completa para traer
                                        productos nuevos y refrescar precios de los
                                        vinculados configurados para seguir a
                                        Contífico. Si solo cambio el inventario, usa
                                        la sincronizacion de stock.
                                    </Text>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        <Button
                                            size="small"
                                            onClick={runProductSync}
                                            disabled={
                                                isSyncingProducts ||
                                                !productSyncActionsGate.enabled
                                            }
                                            isLoading={isSyncingProducts}
                                        >
                                            Importar/Actualizar
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="small"
                                            onClick={previewProductSync}
                                            disabled={
                                                isPreviewingSync ||
                                                isSyncingProducts ||
                                                !productSyncActionsGate.enabled
                                            }
                                            isLoading={isPreviewingSync}
                                        >
                                            Previsualizar cambios
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="small"
                                            onClick={runProductStockSync}
                                            disabled={
                                                isSyncingStock ||
                                                isSyncingProducts ||
                                                !productSyncActionsGate.enabled
                                            }
                                            isLoading={isSyncingStock}
                                        >
                                            Sincronizar stock
                                        </Button>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Text weight="plus">Mantenimiento</Text>
                                        <Badge color="red">Cuidado</Badge>
                                    </div>
                                    <Text className="mt-1 text-ui-fg-subtle text-sm">
                                        Revisa primero el impacto de la limpieza antes de
                                        eliminar productos importados o desincronizar
                                        productos existentes.
                                    </Text>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        <Button
                                            variant="secondary"
                                            size="small"
                                            onClick={previewDeleteSync}
                                            disabled={
                                                isPreviewingDelete ||
                                                isDeletingProducts ||
                                                isSyncingProducts ||
                                                !deleteImportedProductsGate.enabled
                                            }
                                            isLoading={isPreviewingDelete}
                                        >
                                            Previsualizar limpieza
                                        </Button>
                                        <Button
                                            variant="danger"
                                            size="small"
                                            onClick={runDeleteProducts}
                                            disabled={
                                                isDeletingProducts ||
                                                isSyncingProducts ||
                                                !deleteImportedProductsGate.enabled
                                            }
                                            isLoading={isDeletingProducts}
                                        >
                                            Desincronizar y limpiar
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-ui-border-base bg-ui-bg-subtle p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Text weight="plus">Clientes</Text>
                                        <Badge color={syncCustomers ? "green" : "grey"}>
                                            {syncCustomers ? "Activo" : "Inactivo"}
                                        </Badge>
                                    </div>
                                    <Text className="text-ui-fg-subtle text-sm">
                                        Sincroniza clientes entre Medusa y Contifico para
                                        mantener identificacion, correo y datos de
                                        contacto alineados.
                                    </Text>
                                </div>
                                <Switch
                                    checked={syncCustomers}
                                    onCheckedChange={setSyncCustomers}
                                />
                            </div>
                            {syncCustomers && (
                                <div className="mt-4">
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        onClick={runCustomerSync}
                                        disabled={isSyncingCustomers}
                                        isLoading={isSyncingCustomers}
                                    >
                                        Sincronizar ahora
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="rounded-xl border border-ui-border-base bg-ui-bg-subtle p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Text weight="plus">Activar modulo de facturacion y prefacturacion</Text>
                                        <Badge color={autoInvoice || autoPreinvoice ? "green" : "grey"}>
                                            {autoInvoice || autoPreinvoice ? "Activo" : "Inactivo"}
                                        </Badge>
                                    </div>
                                    <Text className="text-ui-fg-subtle text-sm">
                                        Automatiza la creacion de prefacturas y facturas en Contifico.
                                    </Text>
                                    {!autoInvoiceGate.enabled &&
                                        autoInvoiceGate.disabledReason && (
                                            <Text className="text-ui-fg-destructive text-xs">
                                                {autoInvoiceGate.disabledReason}
                                            </Text>
                                        )}
                                </div>
                            </div>
                            
                            {(autoInvoiceGate.enabled || autoInvoice || autoPreinvoice) && (
                                <div className="mt-4 flex flex-col gap-3 border-t border-ui-border-base pt-4">
                                    <div className="flex items-center justify-between">
                                        <Text className="text-ui-fg-subtle text-sm">
                                            Prefacturacion automatica
                                        </Text>
                                        <Switch
                                            checked={autoPreinvoice}
                                            onCheckedChange={controller.setAutoPreinvoice}
                                            disabled={!autoInvoiceGate.enabled}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <Text className="text-ui-fg-subtle text-sm">
                                            Facturacion automatica
                                        </Text>
                                        <Switch
                                            checked={autoInvoice}
                                            onCheckedChange={setAutoInvoice}
                                            disabled={!autoInvoiceGate.enabled}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-xl border border-ui-border-base bg-ui-bg-subtle p-4">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
                            <div className="space-y-1">
                                <Text weight="plus">
                                    Intervalo de sincronizacion automatica
                                </Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Define cada cuantos minutos se revisan productos y
                                    clientes cuando la sincronizacion esta habilitada.
                                </Text>
                                {!syncIntervalGate.enabled &&
                                    syncIntervalGate.disabledReason && (
                                        <Text className="text-ui-fg-subtle text-xs">
                                            {syncIntervalGate.disabledReason}
                                        </Text>
                                    )}
                            </div>
                            <div className="w-full">
                                <Label htmlFor="sync_interval">
                                    Intervalo (minutos)
                                </Label>
                                <Input
                                    id="sync_interval"
                                    type="number"
                                    min={5}
                                    max={1440}
                                    value={syncInterval}
                                    onChange={(event) =>
                                        setSyncInterval(Number(event.target.value))
                                    }
                                    disabled={!syncIntervalGate.enabled}
                                />
                            </div>
                        </div>
                    </div>

                    {hasSyncActivity && (
                        <div className="rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
                            <div className="mb-3">
                                <Text weight="plus">Actividad y previsualizaciones</Text>
                                <Text className="text-ui-fg-subtle text-sm">
                                    Monitorea corridas activas y revisa los resultados
                                    antes de confirmar cambios mas sensibles.
                                </Text>
                            </div>
                            <div className="space-y-3">
                                {syncProgress && (
                                    <ProgressCard progress={syncProgress} color="blue" />
                                )}
                                {deleteProgress && (
                                    <ProgressCard progress={deleteProgress} color="red" />
                                )}
                                {activeSyncLogs.map((log) => (
                                    <ProgressCard
                                        key={log.id}
                                        progress={toProgressState(log)}
                                        color={
                                            log.sync_type === "products-delete"
                                                ? "red"
                                                : "blue"
                                        }
                                    />
                                ))}
                                {syncPreview && (
                                    <PreviewPanel
                                        title="Previsualizacion de sincronizacion"
                                        content={syncPreview}
                                    />
                                )}
                                {deletePreview && (
                                    <PreviewPanel
                                        title="Previsualizacion de limpieza"
                                        content={deletePreview}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </Container>

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

            <SyncLogsTable syncLogs={syncLogs} />
        </>
    )
}

function toProgressState(log: SyncLog) {
    return {
        phase: log.phase || log.status,
        message: buildActiveRunMessage(log),
        percent: log.progress_percent || 0,
    }
}

function buildActiveRunMessage(log: SyncLog) {
    const parts = [
        log.sync_type,
        log.phase || log.status,
        log.parent_log_id ? `hijo de ${log.parent_log_id}` : null,
    ].filter(Boolean)

    return parts.join(" · ")
}

function HeadingBlock() {
    return (
        <>
            <Heading level="h2" className="mb-4">
                Sincronizacion
            </Heading>
            <Text className="mb-4 text-ui-fg-subtle text-sm">
                Centraliza las importaciones, la automatizacion de clientes y la
                facturacion para operar Contifico con menos friccion.
            </Text>
        </>
    )
}

function PreviewPanel({
    title,
    content,
}: {
    title: string
    content: string
}) {
    return (
        <div className="rounded-xl border border-ui-border-base bg-ui-bg-subtle p-3">
            <Text weight="plus" className="mb-2 text-sm">
                {title}
            </Text>
            <pre className="overflow-x-auto rounded-md border border-ui-border-base bg-ui-bg-base p-3 text-xs text-ui-fg-subtle">
                {content}
            </pre>
        </div>
    )
}
