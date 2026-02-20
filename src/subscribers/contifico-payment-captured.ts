import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { CONTIFICO_MODULE } from "../modules/contifico"
import type ContificoModuleService from "../modules/contifico/service"
import { ContificoClient } from "../lib/client"
import type {
    ContificoDocumentoCreate,
    ContificoDocumentoDetalleCreate,
    ContificoDocumentoCliente,
    ContificoCobroCreate,
} from "../lib/types/common"

/** IVA Ecuador 15% */
const IVA_RATE = 15
const TEST_REF_PREFIX = "MEDUSA-TEST"

function today(): string {
    const d = new Date()
    const dd = String(d.getDate()).padStart(2, "0")
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}` // DD/MM/YYYY (Contifico)
}

function nowHour(): string {
    return new Date().toISOString().slice(11, 19)
}

/**
 * Subscriber que crea automáticamente una FACTURA (FAC) en Contifico
 * cuando se captura el pago (payment.captured).
 *
 * El evento payment.captured solo trae { id: paymentId }.
 * Resolvemos la orden via: payment → payment_collection → order
 */
export default async function contificoPaymentCapturedHandler({
    event: { data },
    container,
}: SubscriberArgs<{ id: string }>) {
    const service: ContificoModuleService = container.resolve(CONTIFICO_MODULE)

    // Verificar config
    const [configs] = await service.listAndCountContificoConfigs()
    const config = configs[0]

    if (!config?.auto_invoice_enabled) return
    if (!config.api_key || !config.api_pos) {
        console.warn("[Contifico] Auto-invoice habilitado pero falta API Key o POS")
        return
    }

    const isTestMode = config.invoice_test_mode ?? false
    const paymentId = data.id

    try {
        const query = container.resolve("query") as any

        // ── Resolver orden desde payment → payment_collection → order ──
        const { data: [payment] } = await query.graph({
            entity: "payment",
            fields: [
                "id",
                "payment_collection.order.id",
            ],
            filters: { id: paymentId },
        })

        const orderId = payment?.payment_collection?.order?.id
        if (!orderId) {
            console.log(`[Contifico] Payment ${paymentId}: no tiene orden asociada, saltando`)
            return
        }

        // Verificar que no exista ya una factura para esta orden
        const existing = await service.listContificoEntityMaps({
            entity_type: "invoice",
            medusa_id: orderId,
        })
        const activeFAC = existing.filter(
            (e: any) => (e.metadata as any)?.estado !== "A" && (e.metadata as any)?.tipo_documento === "FAC"
        )
        if (activeFAC.length > 0) {
            console.log(`[Contifico] Orden ${orderId} ya tiene factura, saltando`)
            return
        }

        // ── Cargar orden completa ──
        const { data: [order] } = await query.graph({
            entity: "order",
            fields: [
                "id",
                "display_id",
                "email",
                "customer_id",
                "customer.first_name",
                "customer.last_name",
                "customer.email",
                "customer.metadata",
                "items.id",
                "items.title",
                "items.variant_id",
                "items.product_id",
                "items.unit_price",
                "items.quantity",
                "shipping_address.address_1",
                "shipping_address.city",
                "shipping_address.phone",
            ],
            filters: { id: orderId },
        })

        if (!order) {
            console.error(`[Contifico] Orden ${orderId} no encontrada`)
            return
        }

        // ── Resolver cliente (siempre datos reales, incluso en test mode) ──
        let cliente: ContificoDocumentoCliente

        const customerMaps = order.customer_id
            ? await service.listContificoEntityMaps({
                entity_type: "customer",
                medusa_id: order.customer_id,
            })
            : []

        if (customerMaps.length > 0 && customerMaps[0].metadata) {
            const meta = customerMaps[0].metadata as Record<string, any>
            cliente = {
                cedula: meta.cedula || order.customer?.metadata?.cedula || "9999999999999",
                razon_social: meta.razon_social || `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() || "CONSUMIDOR FINAL",
                tipo: (meta.tipo as "N" | "J" | "I" | "P") || "N",
                email: order.customer?.email || order.email || "",
                direccion: order.shipping_address?.address_1 || "",
                telefonos: order.shipping_address?.phone || "",
                es_extranjero: false,
            }
        } else {
            cliente = {
                cedula: order.customer?.metadata?.cedula || "9999999999999",
                razon_social: `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() || "CONSUMIDOR FINAL",
                tipo: "N",
                email: order.customer?.email || order.email || "",
                direccion: order.shipping_address?.address_1 || "",
                telefonos: order.shipping_address?.phone || "",
                es_extranjero: false,
            }
        }

        // ── Resolver detalles ──
        const detalles: ContificoDocumentoDetalleCreate[] = []
        let subtotal_0 = 0
        let subtotal_12 = 0

        for (const item of (order.items || [])) {
            // La sync de productos crea entity_map con entity_type="product"
            // (aplica para todos los variant_mode: auto, contifico, simple)
            let productoId: string | null = null

            if (item.product_id) {
                const productMaps = await service.listContificoEntityMaps({
                    entity_type: "product",
                    medusa_id: item.product_id,
                })
                if (productMaps.length > 0) {
                    productoId = productMaps[0].contifico_id
                }
            }

            if (!productoId) {
                console.warn(`[Contifico] Sin mapeo para product ${item.product_id}, item: ${item.title}`)
                continue
            }

            const unitPrice = item.unit_price / 100
            const qty = item.quantity
            const lineTotal = unitPrice * qty

            subtotal_12 += lineTotal

            detalles.push({
                producto_id: productoId,
                cantidad: qty,
                precio: unitPrice,
                porcentaje_iva: IVA_RATE,
                base_gravable: lineTotal,
                base_cero: 0,
                base_no_gravable: 0,
                porcentaje_descuento: 0,
                serie: item.variant_sku || item.variant_title || "",
                descripcion: item.title || item.product_title || "Producto",
            })
        }

        if (detalles.length === 0) {
            console.warn(`[Contifico] Orden ${orderId}: ningún item tiene mapeo Contifico, saltando factura`)
            return
        }

        const iva = parseFloat((subtotal_12 * IVA_RATE / 100).toFixed(2))
        const total = parseFloat((subtotal_0 + subtotal_12 + iva).toFixed(2))

        const referencia = isTestMode
            ? `${TEST_REF_PREFIX}-${Date.now()}`
            : `MEDUSA-ORD-${order.display_id || order.id}`

        // FAC = cobrado
        const cobros: ContificoCobroCreate[] = []

        const docPayload: ContificoDocumentoCreate = {
            pos: "",
            fecha_emision: today(),
            hora_emision: nowHour(),
            tipo_registro: "CLI",
            tipo_documento: "FAC", // Siempre FAC, incluso en test
            documento: "001-001-000000001",
            estado: isTestMode ? "P" : "C", // Test=Pendiente, Prod=Cobrado
            electronico: isTestMode ? "0" : "1", // Test=no SRI, Prod=SRI
            autorizacion: isTestMode ? "0000000000" : undefined, // Test=ficticia, Prod=SRI la genera
            reserva_relacionada: null,
            referencia,
            descripcion: isTestMode
                ? `Auto-factura prueba Medusa - ${new Date().toLocaleString()}`
                : `Pedido Medusa #${order.display_id || order.id}`,
            adicional1: null,
            adicional2: null,
            cliente: cliente,
            detalles,
            cobros,
            subtotal_0: parseFloat(subtotal_0.toFixed(2)),
            subtotal_12: parseFloat(subtotal_12.toFixed(2)),
            iva,
            ice: 0,
            servicio: 0,
            total,
        }

        const client = new ContificoClient({
            apiKey: config.api_key,
            apiPos: config.api_pos,
        })

        const docCreated = await client.createDocumento(docPayload)

        // Guardar en entity_map
        await service.createContificoEntityMaps({
            entity_type: "invoice",
            medusa_id: isTestMode ? `test-auto-${Date.now()}` : orderId,
            contifico_id: docCreated.id,
            metadata: {
                referencia,
                tipo_documento: "FAC",
                estado: docCreated.estado,
                total: docCreated.total,
                order_id: orderId,
                test: isTestMode,
                auto: true,
            },
        })

        // Log
        await service.createContificoSyncLogs({
            sync_type: "invoice",
            status: "success",
            total_processed: 1,
            total_errors: 0,
            details: {
                contifico_id: docCreated.id,
                referencia,
                auto: true,
                test: isTestMode,
                triggered_by: "payment.captured",
                payment_id: paymentId,
            },
            duration_ms: 0,
            started_at: new Date().toISOString(),
        })

        console.log(`[Contifico] Auto-factura (payment.captured) creada: ${docCreated.id} ref=${referencia}`)

    } catch (err) {
        console.error(`[Contifico] Error auto-facturando desde payment ${paymentId}:`, err)

        await service.createContificoSyncLogs({
            sync_type: "invoice",
            status: "error",
            total_processed: 0,
            total_errors: 1,
            details: {
                error: (err as Error).message,
                payment_id: paymentId,
                auto: true,
            },
            duration_ms: 0,
            started_at: new Date().toISOString(),
        })
    }
}

export const config: SubscriberConfig = {
    event: "payment.captured",
}
