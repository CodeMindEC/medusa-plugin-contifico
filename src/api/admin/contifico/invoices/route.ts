import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTIFICO_MODULE } from "../../../../modules/contifico"
import type ContificoModuleService from "../../../../modules/contifico/service"
import { ContificoClient } from "../../../../lib/client"
import type {
    ContificoDocumentoCreate,
    ContificoDocumentoDetalleCreate,
    ContificoDocumentoCliente,
    ContificoCobroCreate,
} from "../../../../lib/types/common"

/** Prefijo de referencia para documentos de prueba */
const TEST_REF_PREFIX = "MEDUSA-TEST"

/** IVA Ecuador 15% */
const IVA_RATE = 15

/** Cliente de prueba para modo test */
const TEST_CLIENT: ContificoDocumentoCliente = {
    cedula: "1041831254",
    razon_social: "CONSUMIDOR FINAL PRUEBA",
    tipo: "N",
    email: "dev@prueba.com",
    direccion: "Ciudad",
    telefonos: "0999999999",
    es_extranjero: false,
}

// ── Helpers ─────────────────────────────────────────────────

function today(): string {
    const d = new Date()
    const dd = String(d.getDate()).padStart(2, "0")
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}` // DD/MM/YYYY (Contifico)
}

function nowHour(): string {
    return new Date().toISOString().slice(11, 19) // HH:MM:SS
}

function testRef(): string {
    return `${TEST_REF_PREFIX}-${Date.now()}`
}

function isTestRef(ref?: string | null): boolean {
    return !!ref && ref.startsWith(TEST_REF_PREFIX)
}

/**
 * Construye un documento Contifico a partir de una orden de Medusa.
 */
async function buildDocumentoFromOrder(
    order: any,
    tipo_documento: "PRE" | "FAC",
    service: ContificoModuleService,
    isTestMode: boolean
): Promise<ContificoDocumentoCreate> {
    // ── Resolver cliente (siempre datos reales, incluso en test mode) ──
    let cliente: ContificoDocumentoCliente

    // Intentar buscar persona en Contifico via entity_map
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
        // Sin mapping, usar datos de la orden
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

    // ── Resolver detalles (line items → contifico product IDs) ──
    const detalles: ContificoDocumentoDetalleCreate[] = []
    let subtotal_0 = 0
    let subtotal_12 = 0

    for (const item of (order.items || [])) {
        // La sincronización de productos crea entity_map con entity_type="product"
        // mapeando medusa product.id → contifico product.id (para todos los variant_mode)
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
            throw new Error(
                `No se encontró mapeo Contifico para el item "${item.title}" (product: ${item.product_id}). ` +
                `Asegúrate de sincronizar los productos primero.`
            )
        }

        // Precios en Medusa v2 están en la moneda base (USD para Ecuador),
        // unit_price está en centavos en v2 si el currency tiene decimals
        const unitPrice = item.unit_price / 100 // cents → dollars
        const qty = item.quantity
        const lineTotal = unitPrice * qty

        // IVA: asumimos 15% para Ecuador
        const porcentaje_iva = IVA_RATE
        const base_gravable = lineTotal

        subtotal_12 += lineTotal

        detalles.push({
            producto_id: productoId,
            cantidad: qty,
            precio: unitPrice,
            porcentaje_iva,
            base_gravable,
            base_cero: 0,
            base_no_gravable: 0,
            porcentaje_descuento: 0,
            serie: item.variant_sku || item.variant_title || "-",
            descripcion: item.title || item.product_title || "Producto",
        })
    }

    const iva = parseFloat((subtotal_12 * IVA_RATE / 100).toFixed(2))
    const total = parseFloat((subtotal_0 + subtotal_12 + iva).toFixed(2))

    // ── Referencia ──
    const referencia = isTestMode
        ? testRef()
        : `MEDUSA-ORD-${order.display_id || order.id}`

    // ── Cobros ──
    const cobros: ContificoCobroCreate[] = []

    const doc: ContificoDocumentoCreate = {
        pos: "", // Se inyecta en el client
        fecha_emision: today(),
        hora_emision: nowHour(),
        tipo_registro: "CLI",
        tipo_documento,
        documento: "001-001-000000001", // Auto-generado por Contifico
        estado: isTestMode ? "P" : (tipo_documento === "FAC" ? "C" : "P"), // Test=Pendiente siempre
        electronico: (!isTestMode && tipo_documento === "FAC") ? "1" : "0", // Solo FAC en prod va al SRI
        autorizacion: isTestMode ? "0000000000" : undefined, // Test=autorización ficticia, Prod=SRI la genera
        reserva_relacionada: null,
        referencia,
        descripcion: isTestMode
            ? `Documento de prueba Medusa - ${new Date().toLocaleString()}`
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

    return doc
}

// ── GET /admin/contifico/invoices ────────────────────────────

/**
 * Lista documentos (facturas/prefacturas) creados desde Medusa,
 * almacenados en el entity_map con entity_type = "invoice".
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const service: ContificoModuleService = req.scope.resolve(CONTIFICO_MODULE)

    const invoiceMaps = await service.listContificoEntityMaps({
        entity_type: "invoice",
    })

    // Obtener config para saber si test mode está activo
    const [configs] = await service.listAndCountContificoConfigs()
    const config = configs[0]

    const invoices = invoiceMaps.map((m: any) => ({
        id: m.id,
        medusa_order_id: m.medusa_id,
        contifico_doc_id: m.contifico_id,
        is_test: isTestRef((m.metadata as any)?.referencia),
        referencia: (m.metadata as any)?.referencia || null,
        tipo_documento: (m.metadata as any)?.tipo_documento || null,
        estado: (m.metadata as any)?.estado || null,
        total: (m.metadata as any)?.total || null,
        created_at: m.created_at,
    }))

    res.json({
        invoices,
        test_mode: config?.invoice_test_mode ?? false,
    })
}

// ── POST /admin/contifico/invoices ───────────────────────────
//
// Body.action:
//   "create"       → Crea PRE/FAC desde una orden (requiere order_id)
//   "create-test"  → Crea doc de prueba (requiere test mode)
//   "delete-tests" → Anula todos los docs de prueba

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const service: ContificoModuleService = req.scope.resolve(CONTIFICO_MODULE)
    const { action = "create" } = req.body as { action?: string }

    // Cargar config
    const [configs] = await service.listAndCountContificoConfigs()
    const config = configs[0]
    if (!config?.api_key) {
        res.status(400).json({ error: "Configura la API Key de Contifico primero" })
        return
    }

    switch (action) {
        case "create":
            return handleCreate(req, res, service, config)
        case "create-test":
            return handleCreateTest(req, res, service, config)
        case "delete-tests":
            return handleDeleteTests(req, res, service, config)
        default:
            res.status(400).json({ error: `Acción desconocida: ${action}` })
    }
}

// ── action: "create" ─────────────────────────────────────────

async function handleCreate(
    req: MedusaRequest,
    res: MedusaResponse,
    service: ContificoModuleService,
    config: any
) {
    const { order_id, tipo_documento = "FAC" } = req.body as {
        order_id?: string
        tipo_documento?: "PRE" | "FAC"
    }

    if (!order_id) {
        res.status(400).json({ error: "order_id es requerido" })
        return
    }
    if (!config.api_pos) {
        res.status(400).json({ error: "Configura el API POS para crear documentos" })
        return
    }
    if (!["PRE", "FAC"].includes(tipo_documento)) {
        res.status(400).json({ error: "tipo_documento debe ser PRE o FAC" })
        return
    }

    const isTestMode = config.invoice_test_mode ?? false

    // Verificar duplicado
    const existing = await service.listContificoEntityMaps({
        entity_type: "invoice",
        medusa_id: order_id,
    })
    const activeExisting = existing.filter(
        (e: any) => (e.metadata as any)?.estado !== "A"
    )
    if (activeExisting.length > 0 && !isTestMode) {
        res.status(409).json({
            error: "Ya existe un documento activo para esta orden",
            existing: {
                contifico_id: activeExisting[0].contifico_id,
                referencia: (activeExisting[0].metadata as any)?.referencia,
            },
        })
        return
    }

    try {
        const query = req.scope.resolve("query") as any
        const { data: [order] } = await query.graph({
            entity: "order",
            fields: [
                "id", "display_id", "email", "customer_id",
                "customer.first_name", "customer.last_name",
                "customer.email", "customer.metadata",
                "items.id", "items.title", "items.variant_id",
                "items.product_id", "items.unit_price", "items.quantity",
                "shipping_address.address_1", "shipping_address.city",
                "shipping_address.phone",
            ],
            filters: { id: order_id },
        })

        if (!order) {
            res.status(404).json({ error: `Orden ${order_id} no encontrada` })
            return
        }

        const docPayload = await buildDocumentoFromOrder(order, tipo_documento, service, isTestMode)

        const client = new ContificoClient({
            apiKey: config.api_key,
            apiPos: config.api_pos,
        })

        const docCreated = await client.createDocumento(docPayload)

        await service.createContificoEntityMaps({
            entity_type: "invoice",
            medusa_id: isTestMode ? `test-${Date.now()}` : order_id,
            contifico_id: docCreated.id,
            metadata: {
                referencia: docPayload.referencia,
                tipo_documento,
                estado: docCreated.estado,
                total: docCreated.total,
                order_id,
                test: isTestMode,
            },
        })

        await service.createContificoSyncLogs({
            sync_type: "invoice",
            status: "success",
            total_processed: 1,
            total_errors: 0,
            details: { contifico_id: docCreated.id, tipo_documento, referencia: docPayload.referencia, test: isTestMode },
            duration_ms: 0,
            started_at: new Date().toISOString(),
        })

        res.status(201).json({
            ok: true,
            documento: {
                id: docCreated.id,
                tipo_documento,
                referencia: docPayload.referencia,
                estado: docCreated.estado,
                total: docCreated.total,
                url_ride: docCreated.url_ride,
                test: isTestMode,
            },
        })
    } catch (err: any) {
        console.error("[Contifico] Error creando documento:", err)
        await service.createContificoSyncLogs({
            sync_type: "invoice",
            status: "error",
            total_processed: 0,
            total_errors: 1,
            details: { error: err.message, order_id, tipo_documento },
            duration_ms: 0,
            started_at: new Date().toISOString(),
        })
        res.status(500).json({ error: err.message })
    }
}

// ── action: "create-test" ────────────────────────────────────

async function handleCreateTest(
    req: MedusaRequest,
    res: MedusaResponse,
    service: ContificoModuleService,
    config: any
) {
    if (!config.api_pos) {
        res.status(400).json({ error: "Configura el API POS para crear documentos" })
        return
    }
    if (!config.invoice_test_mode) {
        res.status(403).json({ error: "El modo de prueba no está habilitado" })
        return
    }

    const { tipo_documento = "PRE" } = req.body as { tipo_documento?: "PRE" | "FAC" }

    if (!["PRE", "FAC"].includes(tipo_documento)) {
        res.status(400).json({ error: "tipo_documento debe ser PRE o FAC" })
        return
    }

    try {
        const client = new ContificoClient({
            apiKey: config.api_key,
            apiPos: config.api_pos,
        })

        // Buscar un producto vinculado para usar en el detalle de prueba
        const products = await service.listContificoEntityMaps({ entity_type: "product" })
        const prodId = products.length > 0 ? products[0].contifico_id : null

        if (!prodId) {
            res.status(400).json({
                error: "No hay productos vinculados con Contifico. Sincroniza productos primero.",
            })
            return
        }

        const unitPrice = 1.00
        const qty = 1
        const subtotal_12 = unitPrice * qty
        const iva = parseFloat((subtotal_12 * IVA_RATE / 100).toFixed(2))
        const total = parseFloat((subtotal_12 + iva).toFixed(2))
        const referencia = testRef()

        const cobros: ContificoCobroCreate[] = []

        const docPayload: ContificoDocumentoCreate = {
            pos: "",
            fecha_emision: today(),
            hora_emision: nowHour(),
            tipo_registro: "CLI",
            tipo_documento,
            documento: "001-001-000000001",
            estado: "P", // handleCreateTest siempre Pendiente
            electronico: "0", // Test nunca va al SRI
            autorizacion: "0000000000", // Autorización ficticia para test
            reserva_relacionada: null,
            referencia,
            descripcion: `Documento de prueba Medusa - ${new Date().toLocaleString()}`,
            adicional1: null,
            adicional2: null,
            cliente: TEST_CLIENT,
            detalles: [{
                producto_id: prodId,
                cantidad: qty,
                precio: unitPrice,
                porcentaje_iva: IVA_RATE,
                base_gravable: subtotal_12,
                base_cero: 0,
                base_no_gravable: 0,
                porcentaje_descuento: 0,
                serie: "TEST",
                descripcion: "Producto de prueba Medusa",
            }],
            cobros,
            subtotal_0: 0,
            subtotal_12,
            iva,
            ice: 0,
            servicio: 0,
            total,
        }

        const docCreated = await client.createDocumento(docPayload)

        await service.createContificoEntityMaps({
            entity_type: "invoice",
            medusa_id: `test-${Date.now()}`,
            contifico_id: docCreated.id,
            metadata: {
                referencia,
                tipo_documento,
                estado: docCreated.estado,
                total: docCreated.total,
                test: true,
            },
        })

        res.status(201).json({
            ok: true,
            documento: {
                id: docCreated.id,
                tipo_documento,
                referencia,
                estado: docCreated.estado,
                total: docCreated.total,
                url_ride: docCreated.url_ride,
                test: true,
            },
        })
    } catch (err: any) {
        console.error("[Contifico] Error creando documento test:", err)
        res.status(500).json({ error: err.message })
    }
}

// ── action: "delete-tests" ───────────────────────────────────

async function handleDeleteTests(
    req: MedusaRequest,
    res: MedusaResponse,
    service: ContificoModuleService,
    config: any
) {
    if (!config.invoice_test_mode) {
        res.status(403).json({ error: "El modo de prueba no está habilitado" })
        return
    }

    try {
        const client = new ContificoClient({
            apiKey: config.api_key,
            apiPos: config.api_pos || undefined,
        })

        const testInvoices = await service.listContificoEntityMaps({
            entity_type: "invoice",
        })

        const toAnular = testInvoices.filter((inv: any) => {
            const meta = inv.metadata as Record<string, any> | null
            return meta?.test === true && meta?.estado !== "A"
        })

        if (toAnular.length === 0) {
            res.json({ ok: true, anulados: 0, message: "No hay documentos de prueba para anular" })
            return
        }

        let anulados = 0
        const errors: string[] = []

        for (const inv of toAnular) {
            try {
                // Intentar anular en Contifico via API
                try {
                    await client.anularDocumento(inv.contifico_id)
                } catch (apiErr: any) {
                    // Si falla la anulación en Contifico (ej: doc no electrónico),
                    // igual limpiamos el registro local
                    console.warn(
                        `[Contifico] No se pudo anular ${inv.contifico_id} en Contifico (se eliminará el registro local): ${apiErr.message}`
                    )
                }
                // Siempre marcar como anulado en el entity_map local
                await service.updateContificoEntityMaps({
                    id: inv.id,
                    metadata: {
                        ...(inv.metadata as Record<string, any>),
                        estado: "A",
                    },
                })
                anulados++
            } catch (err: any) {
                errors.push(`${inv.contifico_id}: ${err.message}`)
            }
        }

        await service.createContificoSyncLogs({
            sync_type: "invoice",
            status: errors.length > 0 ? "partial" : "success",
            total_processed: anulados,
            total_errors: errors.length,
            details: { action: "delete-tests", errors },
            duration_ms: 0,
            started_at: new Date().toISOString(),
        })

        res.json({
            ok: errors.length === 0,
            anulados,
            errores: errors.length,
            message: `${anulados} documento(s) de prueba anulados${errors.length > 0 ? `, ${errors.length} errores` : ""}`,
            errors: errors.length > 0 ? errors : undefined,
        })
    } catch (err: any) {
        console.error("[Contifico] Error anulando documentos test:", err)
        res.status(500).json({ error: err.message })
    }
}
