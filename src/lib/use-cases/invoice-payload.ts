/**
 * Invoice payload — Build Contifico document payloads from Medusa orders.
 *
 * Split into sub-modules:
 * - invoice-payload-customer.ts → Customer resolution (cédula, RUC, tipo persona)
 * - invoice-payload-test.ts     → Test document payloads
 */

import { ContificoClient } from "../client"
import {
    resolveEffectiveProductRules,
    type AdvancedContificoSettings,
} from "../advanced-settings"
import { asProductMapMetadata } from "../contifico-metadata"
import {
    calculateWeightedInvoiceQuantity,
    getEffectiveMappingMode,
    getVariantWeightGrams,
    resolveWeightedPvpField,
    roundCurrency,
    roundDecimal,
} from "../contifico-weighted"
import { resolveWeightedPricePerGram } from "../strategies/pricing"
import { renderTemplate } from "../strategies/invoicing"
import type {
    ContificoCobroCreate,
    ContificoDocumentoCreate,
    ContificoDocumentoDetalleCreate,
    ContificoProducto,
} from "../types"
import type ContificoModuleService from "../../modules/contifico/service"
import { getContificoConfig } from "../../api/admin/contifico/shared"
import { resolveCliente } from "./invoice-payload-customer"
import { testRef } from "./invoice-payload-test"

// ── Re-exports (backward compatibility) ──────────────────
export { createTestDocumentoPayload, isTestRef } from "./invoice-payload-test"
export { TEST_CLIENT } from "./invoice-payload-customer"

// ── Constants ────────────────────────────────────────────

const IVA_RATE = 15

// ── Types ────────────────────────────────────────────────

export interface InvoiceOrderGraph {
    id: string
    display_id?: string | number | null
    email?: string | null
    payment_status?: string | null
    updated_at?: string | null
    metadata?: Record<string, unknown> | null
    customer_id?: string | null
    customer?: {
        first_name?: string | null
        last_name?: string | null
        email?: string | null
        metadata?: Record<string, unknown> | null
    } | null
    shipping_address?: {
        first_name?: string | null
        last_name?: string | null
        address_1?: string | null
        city?: string | null
        phone?: string | null
        metadata?: Record<string, unknown> | null
    } | null
    billing_address?: {
        first_name?: string | null
        last_name?: string | null
        address_1?: string | null
        city?: string | null
        phone?: string | null
        metadata?: Record<string, unknown> | null
    } | null
    items?: Array<{
        id: string
        title?: string | null
        variant_id?: string | null
        variant_sku?: string | null
        variant_title?: string | null
        product_id?: string | null
        product_title?: string | null
        unit_price?: number | null
        quantity?: number | null
        variant?: {
            title?: string | null
            sku?: string | null
            weight?: number | null
            metadata?: Record<string, unknown> | null
        } | null
        detail?: {
            quantity?: number | null
            unit_price?: number | null
        } | null
        adjustments?: Array<{
            id: string
            amount: number
            code?: string | null
            description?: string | null
        }> | null
    }>
}

export interface InvoiceConfig {
    api_key: string
    api_pos: string | null
    auto_invoice_enabled: boolean
    auto_preinvoice_enabled: boolean
    sync_products_enabled: boolean
    invoice_test_mode: boolean
    variant_mode: "auto" | "contifico" | "simple" | "weighted"
    weighted_pvp_field: "pvp1" | "pvp2" | "pvp3" | "pvp4"
    advanced_settings: AdvancedContificoSettings
}

interface ResolvedProductMap {
    contifico_id: string
    metadata?: Record<string, unknown> | null
}

interface WeightedDetailAccumulator {
    producto_id: string
    descripcion: string
    serie: string
    cantidad: number
    precio: number
    base_gravable: number
    discount_total: number
}

interface OrderTotalsSummary {
    subtotal: number
    items: number
}

interface InvoiceTemplateValues {
    [key: string]: string | number
    id: string
    display_id: string | number
    email: string
}

// ── Config ───────────────────────────────────────────────

export async function getRequiredInvoiceConfig(
    service: ContificoModuleService
): Promise<InvoiceConfig | null> {
    const { normalized } = await getContificoConfig(service)
    if (!normalized?.api_key) {
        return null
    }

    return {
        api_key: normalized.api_key,
        api_pos: normalized.api_pos,
        auto_invoice_enabled: normalized.auto_invoice_enabled,
        auto_preinvoice_enabled: normalized.auto_preinvoice_enabled,
        sync_products_enabled: normalized.sync_products_enabled,
        invoice_test_mode: normalized.invoice_test_mode,
        variant_mode: normalized.variant_mode,
        weighted_pvp_field: normalized.weighted_pvp_field,
        advanced_settings: normalized.advanced_settings,
    }
}

// ── Main payload builder ─────────────────────────────────

export async function buildDocumentoFromOrder(
    order: InvoiceOrderGraph,
    tipo_documento: "PRE" | "FAC",
    service: ContificoModuleService,
    config: InvoiceConfig
): Promise<ContificoDocumentoCreate> {
    const cliente = await resolveCliente(order, service)
    const detalles: ContificoDocumentoDetalleCreate[] = []
    const weightedGroups = new Map<string, WeightedDetailAccumulator>()
    let weightedProductsMap: Map<string, ContificoProducto> | null = null

    for (const item of order.items || []) {
        const productMap = await resolveContificoProductMap(item.product_id || null, service)
        if (!productMap?.contifico_id) {
            if (config.advanced_settings.invoicing.on_missing_mapping === "skip_line") {
                continue
            }
            throw new Error(
                `No se encontro mapeo Contifico para el item "${item.title}" (product: ${item.product_id}).`
            )
        }

        const mappingMetadata = asProductMapMetadata(productMap.metadata)
        const effectiveMappingMode = getEffectiveMappingMode(config, mappingMetadata)
        const effectiveRules = resolveEffectiveProductRules(
            config.advanced_settings,
            mappingMetadata.product_rules_override || null
        )
        const quantity = Number(item.quantity ?? item.detail?.quantity ?? 1)
        const baseUnitPrice = parseFloat(
            Number(item.unit_price ?? item.detail?.unit_price ?? 0).toFixed(2)
        )
        const grossLineTotal = roundCurrency(baseUnitPrice * quantity)
        const itemDiscountTotal = sumItemAdjustments(item.adjustments)
        const lineTotal = roundCurrency(grossLineTotal - itemDiscountTotal)

        if (effectiveMappingMode === "weighted") {
            const gramsPerVariant = getVariantWeightGrams(item.variant)
            if (gramsPerVariant == null) {
                const variantLabel =
                    item.variant?.title ||
                    item.variant_title ||
                    item.variant?.sku ||
                    item.variant_sku ||
                    item.title ||
                    item.id
                throw new Error(
                    `La variante "${variantLabel}" requiere un peso válido para facturar en modo weighted.`
                )
            }

            if (!weightedProductsMap) {
                weightedProductsMap = await loadContificoProductsMap(config)
            }

            const contificoProduct = weightedProductsMap.get(productMap.contifico_id)
            if (!contificoProduct) {
                throw new Error(
                    `No se pudo cargar el producto Contífico ${productMap.contifico_id} para facturar en modo weighted.`
                )
            }

            const weightedPvpField = resolveWeightedPvpField(
                config,
                effectiveRules.weighted,
                gramsPerVariant,
                mappingMetadata
            )
            const pricingResult = resolveWeightedPricePerGram(
                contificoProduct,
                weightedPvpField,
                effectiveRules.pricing
            )
            if (!pricingResult) {
                throw new Error(
                    `El producto "${contificoProduct.nombre}" no tiene un ${weightedPvpField} válido para facturar en modo weighted.`
                )
            }

            const quantityInGrams = calculateWeightedInvoiceQuantity(quantity, gramsPerVariant)
            const useContificoOfficialPrice =
                config.sync_products_enabled &&
                effectiveRules.weighted.allow_weighted_price_sync
            const weightedBaseGravableBeforeDiscount = useContificoOfficialPrice
                ? roundCurrency(quantityInGrams * pricingResult.amount)
                : grossLineTotal
            const weightedBaseGravable = roundCurrency(
                weightedBaseGravableBeforeDiscount - itemDiscountTotal
            )
            upsertWeightedGroup(weightedGroups, {
                producto_id: productMap.contifico_id,
                descripcion:
                    contificoProduct.nombre || item.product_title || item.title || "Producto",
                serie: weightedPvpField.toUpperCase(),
                cantidad: quantityInGrams,
                precio: pricingResult.amount,
                base_gravable: weightedBaseGravable,
                discount_total: itemDiscountTotal,
            })
            continue
        }

        const porcentajeDescuento = grossLineTotal > 0
            ? roundCurrency((itemDiscountTotal / grossLineTotal) * 100)
            : 0

        detalles.push(
            buildDetalle({
                producto_id: productMap.contifico_id,
                cantidad: quantity,
                precio: baseUnitPrice,
                base_gravable: lineTotal,
                porcentaje_descuento: porcentajeDescuento,
                serie:
                    item.variant?.sku ||
                    item.variant_sku ||
                    item.variant?.title ||
                    item.variant_title ||
                    "-",
                descripcion: item.title || item.product_title || "Producto",
            })
        )
    }

    for (const group of weightedGroups.values()) {
        const grossBase = roundCurrency(group.base_gravable + group.discount_total)
        const porcentajeDescuento = grossBase > 0
            ? roundCurrency((group.discount_total / grossBase) * 100)
            : 0

        detalles.push(
            buildDetalle({
                producto_id: group.producto_id,
                cantidad: group.cantidad,
                precio: group.precio,
                base_gravable: group.base_gravable,
                porcentaje_descuento: porcentajeDescuento,
                serie: group.serie,
                descripcion: group.descripcion,
            })
        )
    }

    const subtotal_12 = roundCurrency(
        detalles.reduce((acc, detail) => acc + Number(detail.base_gravable || 0), 0)
    )
    const iva = parseFloat(((subtotal_12 * IVA_RATE) / 100).toFixed(2))
    const total = parseFloat((subtotal_12 + iva).toFixed(2))
    const templateValues = buildOrderInvoiceTemplateValues(order)
    const referencia = buildOrderInvoiceReference(order, config) || testRef()
    const descripcion = config.invoice_test_mode
        ? `Documento de prueba Medusa - ${new Date().toLocaleString()}`
        : renderTemplate(
            config.advanced_settings.invoicing.description_template,
            templateValues
        ).value

    return {
        pos: "",
        fecha_emision: today(),
        hora_emision: nowHour(),
        tipo_registro: "CLI",
        tipo_documento,
        documento: `999-999-${String(Date.now()).slice(-9).padStart(9, "0")}`,
        estado: config.invoice_test_mode ? "P" : tipo_documento === "FAC" ? "C" : "P",
        electronico: !config.invoice_test_mode && tipo_documento === "FAC" ? "1" : "0",
        autorizacion: "0000000000",
        reserva_relacionada: null,
        referencia,
        descripcion,
        adicional1: null,
        adicional2: null,
        cliente,
        detalles,
        cobros: [] satisfies ContificoCobroCreate[],
        subtotal_0: 0,
        subtotal_12,
        iva,
        ice: 0,
        servicio: 0,
        total,
    }
}

// ── Template & reference helpers ─────────────────────────

export function buildOrderInvoiceTemplateValues(
    order: Pick<InvoiceOrderGraph, "id" | "display_id" | "email" | "customer">
): InvoiceTemplateValues {
    return {
        id: order.id,
        display_id: order.display_id || order.id,
        email: order.email || order.customer?.email || "",
    }
}

export function buildOrderInvoiceReference(
    order: Pick<InvoiceOrderGraph, "id" | "display_id" | "email" | "customer">,
    config: Pick<InvoiceConfig, "invoice_test_mode" | "advanced_settings">
): string | null {
    if (config.invoice_test_mode) {
        return null
    }

    return renderTemplate(
        config.advanced_settings.invoicing.reference_template,
        buildOrderInvoiceTemplateValues(order)
    ).value
}

// ── Totals ───────────────────────────────────────────────

export function calculateOrderTotalsFromOrder(
    order: Pick<InvoiceOrderGraph, "items">
): OrderTotalsSummary {
    const subtotal = roundCurrency(
        (order.items || []).reduce((total, item) => {
            const quantity = Number(item.quantity ?? item.detail?.quantity ?? 1)
            const unitPrice = roundCurrency(
                Number(item.unit_price ?? item.detail?.unit_price ?? 0)
            )
            const itemDiscount = sumItemAdjustments(item.adjustments)

            return total + roundCurrency(roundCurrency(unitPrice * quantity) - itemDiscount)
        }, 0)
    )

    return {
        subtotal,
        items: (order.items || []).length,
    }
}

// ── Private helpers ──────────────────────────────────────

function sumItemAdjustments(
    adjustments?: Array<{ amount: number }> | null
): number {
    if (!adjustments?.length) return 0
    return roundCurrency(
        adjustments.reduce((total, adj) => total + (Number(adj.amount) || 0), 0)
    )
}

function buildDetalle(
    input: Pick<
        ContificoDocumentoDetalleCreate,
        "producto_id" | "cantidad" | "precio" | "base_gravable" | "serie" | "descripcion" | "porcentaje_descuento"
    >
): ContificoDocumentoDetalleCreate {
    return {
        ...input,
        porcentaje_descuento: input.porcentaje_descuento || 0,
        porcentaje_iva: IVA_RATE,
        base_cero: 0,
        base_no_gravable: 0,
    }
}

function upsertWeightedGroup(
    groups: Map<string, WeightedDetailAccumulator>,
    input: WeightedDetailAccumulator
) {
    const current = groups.get(input.producto_id)
    const cantidad = roundCurrency((current?.cantidad || 0) + input.cantidad)
    const baseGravable = roundCurrency((current?.base_gravable || 0) + input.base_gravable)
    const discountTotal = roundCurrency((current?.discount_total || 0) + input.discount_total)
    const grossBase = roundCurrency(baseGravable + discountTotal)

    groups.set(input.producto_id, {
        producto_id: input.producto_id,
        descripcion: input.descripcion,
        serie: current && current.serie !== input.serie ? "PVP-MIX" : input.serie,
        cantidad,
        precio: cantidad > 0 ? roundDecimal(grossBase / cantidad, 6) : 0,
        base_gravable: baseGravable,
        discount_total: discountTotal,
    })
}

async function resolveContificoProductMap(
    productId: string | null,
    service: ContificoModuleService
): Promise<ResolvedProductMap | null> {
    if (!productId) {
        return null
    }

    const productMaps = await service.listContificoEntityMaps({
        entity_type: "product",
        medusa_id: productId,
    })

    const map = productMaps[0]
    if (!map) {
        return null
    }

    return {
        contifico_id: map.contifico_id,
        metadata: map.metadata as Record<string, unknown> | null,
    }
}

async function loadContificoProductsMap(
    config: Pick<InvoiceConfig, "api_key">
): Promise<Map<string, ContificoProducto>> {
    const client = new ContificoClient({
        apiKey: config.api_key,
    })
    const products = await client.getAllProductos()
    return new Map(products.map((product) => [product.id, product]))
}

function today(): string {
    const date = new Date()
    return `${String(date.getDate()).padStart(2, "0")}/${String(
        date.getMonth() + 1
    ).padStart(2, "0")}/${date.getFullYear()}`
}

function nowHour(): string {
    return new Date().toISOString().slice(11, 19)
}