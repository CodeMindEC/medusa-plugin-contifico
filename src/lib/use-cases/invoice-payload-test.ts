/**
 * Invoice payload — Test document generation.
 *
 * Creates test (dummy) Contifico document payloads using
 * hardcoded client data and the first available mapped product.
 */

import type { ContificoCobroCreate, ContificoDocumentoCreate } from "../types"
import type ContificoModuleService from "../../modules/contifico/service"
import { TEST_CLIENT } from "./invoice-payload-customer"

const TEST_REF_PREFIX = "MEDUSA-TEST"
const IVA_RATE = 15

// ── Test payload builder ─────────────────────────────────

export async function createTestDocumentoPayload(
    service: ContificoModuleService,
    tipo_documento: "PRE" | "FAC"
): Promise<ContificoDocumentoCreate> {
    const products = await service.listContificoEntityMaps({ entity_type: "product" })
    const productId = products[0]?.contifico_id

    if (!productId) {
        throw new Error(
            "No hay productos vinculados con Contifico. Sincroniza productos primero."
        )
    }

    const subtotal_12 = 1
    const iva = parseFloat(((subtotal_12 * IVA_RATE) / 100).toFixed(2))
    const total = parseFloat((subtotal_12 + iva).toFixed(2))

    return {
        pos: "",
        fecha_emision: today(),
        hora_emision: nowHour(),
        tipo_registro: "CLI",
        tipo_documento,
        documento: `999-999-${String(Date.now()).slice(-9).padStart(9, "0")}`,
        estado: "P",
        electronico: "0",
        autorizacion: "0000000000",
        reserva_relacionada: null,
        referencia: testRef(),
        descripcion: `Documento de prueba Medusa - ${new Date().toLocaleString()}`,
        adicional1: null,
        adicional2: null,
        cliente: TEST_CLIENT,
        detalles: [
            {
                producto_id: productId,
                cantidad: 1,
                precio: 1,
                porcentaje_iva: IVA_RATE,
                base_gravable: subtotal_12,
                base_cero: 0,
                base_no_gravable: 0,
                porcentaje_descuento: 0,
                serie: "TEST",
                descripcion: "Producto de prueba Medusa",
            },
        ],
        cobros: [] satisfies ContificoCobroCreate[],
        subtotal_0: 0,
        subtotal_12,
        iva,
        ice: 0,
        servicio: 0,
        total,
    }
}

// ── Test reference helpers ───────────────────────────────

export function isTestRef(reference?: string | null): boolean {
    return !!reference && reference.startsWith(TEST_REF_PREFIX)
}

export function testRef(): string {
    return `${TEST_REF_PREFIX}-${Date.now()}`
}

// ── Private helpers ──────────────────────────────────────

function today(): string {
    const date = new Date()
    return `${String(date.getDate()).padStart(2, "0")}/${String(
        date.getMonth() + 1
    ).padStart(2, "0")}/${date.getFullYear()}`
}

function nowHour(): string {
    return new Date().toISOString().slice(11, 19)
}
