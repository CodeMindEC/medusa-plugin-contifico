import {
    Badge,
    Button,
    Container,
    Heading,
    Input,
    Label,
    Switch,
    Table,
    Text,
} from "@medusajs/ui"
import type { ContificoSettingsController } from "../state"
import { UiSelectField } from "./ui-select-field"

export function InvoicesSection({
    controller,
}: {
    controller: ContificoSettingsController
}) {
    const {
        activeTestInvoicesCount,
        clearInvoiceFilters,
        createTestInvoice,
        deleteTestInvoices,
        fetchInvoices,
        filterDateStr,
        filterStatus,
        filterType,
        filteredInvoices,
        invoicePreview,
        invoicePreviewOrderId,
        invoicePreviewType,
        invoiceStatusFilterOptions,
        invoiceTestMode,
        invoiceTypeFilterOptions,
        invoiceTypeOptions,
        invoices,
        isCreatingTestFAC,
        isCreatingTestPRE,
        isDeletingTestDocs,
        isPreviewingInvoice,
        isTableOpen,
        apiPos,
        previewInvoicePayload,
        setFilterDateStr,
        setFilterStatus,
        setFilterType,
        setInvoicePreviewOrderId,
        setInvoicePreviewType,
        setInvoiceTestMode,
        setIsTableOpen,
    } = controller

    return (
        <Container className="mb-6 p-6">
            <HeadingBlock />
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <Text weight="plus">Modo de prueba</Text>
                        <Text className="text-ui-fg-subtle text-sm">
                            Genera documentos con referencia MEDUSA-TEST-* y cliente de
                            prueba. Los documentos de prueba se pueden anular fácilmente.
                        </Text>
                    </div>
                    <SwitchBlock checked={invoiceTestMode} onCheckedChange={setInvoiceTestMode} />
                </div>

                {invoiceTestMode && (
                    <div className="p-4 bg-ui-bg-subtle rounded-lg border border-ui-border-base space-y-3">
                        <div className="flex items-center gap-2">
                            <Badge color="orange">MODO PRUEBA</Badge>
                            <Text className="text-sm text-ui-fg-subtle">
                                Los documentos auto-generados usan datos reales del
                                cliente. Los manuales usan CONSUMIDOR FINAL PRUEBA.
                            </Text>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                size="small"
                                disabled={isCreatingTestPRE || isCreatingTestFAC || !apiPos}
                                isLoading={isCreatingTestPRE}
                                onClick={() => createTestInvoice("PRE")}
                            >
                                Crear Prefactura Test
                            </Button>
                            <Button
                                variant="secondary"
                                size="small"
                                disabled={isCreatingTestPRE || isCreatingTestFAC || !apiPos}
                                isLoading={isCreatingTestFAC}
                                onClick={() => createTestInvoice("FAC")}
                            >
                                Crear Factura Test
                            </Button>
                            <Button
                                variant="danger"
                                size="small"
                                disabled={isDeletingTestDocs || activeTestInvoicesCount === 0}
                                isLoading={isDeletingTestDocs}
                                onClick={deleteTestInvoices}
                            >
                                Anular pruebas ({activeTestInvoicesCount})
                            </Button>
                        </div>
                        {!apiPos && (
                            <Text className="text-ui-fg-destructive text-xs">
                                Configura el API POS arriba para poder crear documentos
                            </Text>
                        )}
                    </div>
                )}

                <div className="p-4 bg-ui-bg-subtle rounded-lg border border-ui-border-base space-y-3">
                    <div>
                        <Text weight="plus">Preview de factura</Text>
                        <Text className="text-ui-fg-subtle text-sm">
                            Simula el payload final antes de crear el documento en
                            Contífico.
                        </Text>
                    </div>
                    <div className="flex items-end gap-3 flex-wrap">
                        <div className="min-w-[220px]">
                            <Label htmlFor="invoice_preview_order_id">Order ID</Label>
                            <Input
                                id="invoice_preview_order_id"
                                value={invoicePreviewOrderId}
                                onChange={(event) =>
                                    setInvoicePreviewOrderId(event.target.value)
                                }
                                placeholder="order_..."
                            />
                        </div>
                        <div>
                            <Label htmlFor="invoice_preview_type">Tipo</Label>
                            <UiSelectField
                                value={invoicePreviewType}
                                onValueChange={setInvoicePreviewType}
                                options={invoiceTypeOptions}
                                placeholder="Tipo"
                                triggerClassName="w-[180px]"
                            />
                        </div>
                        <Button
                            variant="secondary"
                            isLoading={isPreviewingInvoice}
                            disabled={!invoicePreviewOrderId}
                            onClick={previewInvoicePayload}
                        >
                            Simular factura
                        </Button>
                    </div>
                    {invoicePreview && (
                        <pre className="overflow-x-auto rounded-md border border-ui-border-base bg-ui-bg-base p-3 text-xs text-ui-fg-subtle">
                            {invoicePreview}
                        </pre>
                    )}
                </div>

                {invoices.length > 0 && (
                    <div className="mt-4 border border-ui-border-base rounded-lg overflow-hidden bg-ui-bg-subtle">
                        <button
                            onClick={() => setIsTableOpen(!isTableOpen)}
                            className="w-full flex items-center justify-between p-4 hover:bg-ui-bg-base transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Text weight="plus">
                                    Documentos creados ({filteredInvoices.length})
                                </Text>
                            </div>
                            <Text className="text-ui-fg-subtle">
                                {isTableOpen ? "Ocultar ▲" : "Expandir ▼"}
                            </Text>
                        </button>

                        {isTableOpen && (
                            <div className="p-4 bg-ui-bg-base border-t border-ui-border-base">
                                <div className="flex items-end justify-between gap-4 mb-4 flex-wrap">
                                    <div className="flex items-center gap-4 flex-wrap">
                                        <div>
                                            <Label className="mb-1 text-xs">Estado</Label>
                                            <UiSelectField
                                                value={filterStatus}
                                                onValueChange={setFilterStatus}
                                                options={invoiceStatusFilterOptions}
                                                placeholder="Estado"
                                                triggerClassName="w-[160px]"
                                            />
                                        </div>
                                        <div>
                                            <Label className="mb-1 text-xs">Tipo</Label>
                                            <UiSelectField
                                                value={filterType}
                                                onValueChange={setFilterType}
                                                options={invoiceTypeFilterOptions}
                                                placeholder="Tipo"
                                                triggerClassName="w-[160px]"
                                            />
                                        </div>
                                        <div>
                                            <Label className="mb-1 text-xs">Fecha Exacta</Label>
                                            <Input
                                                type="date"
                                                value={filterDateStr}
                                                onChange={(event) =>
                                                    setFilterDateStr(event.target.value)
                                                }
                                                className="max-w-[150px]"
                                            />
                                        </div>
                                        {(filterStatus !== "ALL" ||
                                            filterType !== "ALL" ||
                                            filterDateStr !== "") && (
                                            <Button
                                                variant="transparent"
                                                size="small"
                                                className="mt-5"
                                                onClick={clearInvoiceFilters}
                                            >
                                                Limpiar
                                            </Button>
                                        )}
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        className="mt-5"
                                        onClick={() => fetchInvoices()}
                                    >
                                        Actualizar
                                    </Button>
                                </div>

                                <div className="overflow-x-auto">
                                    <Table>
                                        <Table.Header>
                                            <Table.Row>
                                                <Table.HeaderCell>Tipo</Table.HeaderCell>
                                                <Table.HeaderCell>Número</Table.HeaderCell>
                                                <Table.HeaderCell>Referencia</Table.HeaderCell>
                                                <Table.HeaderCell>Estado</Table.HeaderCell>
                                                <Table.HeaderCell>Total</Table.HeaderCell>
                                                <Table.HeaderCell>Fecha</Table.HeaderCell>
                                            </Table.Row>
                                        </Table.Header>
                                        <Table.Body>
                                            {filteredInvoices.length > 0 ? (
                                                filteredInvoices.map((invoice) => (
                                                    <Table.Row key={invoice.id}>
                                                        <Table.Cell>
                                                            <div className="flex items-center gap-1">
                                                                <Badge
                                                                    color={
                                                                        invoice.tipo_documento ===
                                                                        "FAC"
                                                                            ? "blue"
                                                                            : "purple"
                                                                    }
                                                                >
                                                                    {invoice.tipo_documento || "?"}
                                                                </Badge>
                                                                {invoice.is_test && (
                                                                    <Badge
                                                                        color="orange"
                                                                        className="text-xs"
                                                                    >
                                                                        TEST
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text className="text-sm font-mono whitespace-nowrap">
                                                                {invoice.documento ||
                                                                    "(Sin emisión)"}
                                                            </Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text className="text-sm font-mono whitespace-nowrap">
                                                                {invoice.referencia || "-"}
                                                            </Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Badge
                                                                color={
                                                                    invoice.estado === "A"
                                                                        ? "red"
                                                                        : invoice.estado === "C"
                                                                          ? "green"
                                                                          : "grey"
                                                                }
                                                            >
                                                                {invoice.estado === "A"
                                                                    ? "Anulado"
                                                                    : invoice.estado === "C"
                                                                      ? "Cobrado"
                                                                      : invoice.estado === "P"
                                                                        ? "Pendiente"
                                                                        : invoice.estado || "?"}
                                                            </Badge>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            $
                                                            {parseFloat(
                                                                invoice.total || "0"
                                                            ).toFixed(2)}
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            {new Date(
                                                                invoice.created_at
                                                            ).toLocaleString()}
                                                        </Table.Cell>
                                                    </Table.Row>
                                                ))
                                            ) : (
                                                <Table.Row>
                                                    <td
                                                        colSpan={6}
                                                        className="text-center text-ui-fg-subtle py-4 px-4 text-sm"
                                                    >
                                                        No hay documentos con estos filtros
                                                    </td>
                                                </Table.Row>
                                            )}
                                        </Table.Body>
                                    </Table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Container>
    )
}

function HeadingBlock() {
    return (
        <>
            <Heading level="h2" className="mb-2">
                Facturación
            </Heading>
            <Text className="text-ui-fg-subtle text-sm mb-4">
                Gestiona la creación de prefacturas y facturas en Contifico.
            </Text>
        </>
    )
}

function SwitchBlock({
    checked,
    onCheckedChange,
}: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
}) {
    return <Switch checked={checked} onCheckedChange={onCheckedChange} />
}
