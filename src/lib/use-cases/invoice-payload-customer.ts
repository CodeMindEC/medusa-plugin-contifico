/**
 * Invoice payload — Customer resolution for Contifico documents.
 *
 * Resolves the `cliente` block for a Contifico document from order data,
 * customer entity maps, and metadata cascading (customer → order → address).
 */

import { asCustomerMapMetadata } from "../contifico-metadata"
import type { ContificoDocumentoCliente } from "../types"
import type ContificoModuleService from "../../modules/contifico/service"
import type { InvoiceOrderGraph } from "./invoice-payload"

// ── Constants ────────────────────────────────────────────

export const TEST_CLIENT: ContificoDocumentoCliente = {
    cedula: "1041831254",
    razon_social: "CONSUMIDOR FINAL PRUEBA",
    tipo: "N",
    email: "dev@prueba.com",
    direccion: "Ciudad",
    telefonos: "0999999999",
    es_extranjero: false,
}

// ── Main resolver ────────────────────────────────────────

export async function resolveCliente(
    order: InvoiceOrderGraph,
    service: ContificoModuleService
): Promise<ContificoDocumentoCliente> {
    const customerMaps = order.customer_id
        ? await service.listContificoEntityMaps({
            entity_type: "customer",
            medusa_id: order.customer_id,
        })
        : []

    const mappedCustomer = customerMaps[0]
    const metadata = asCustomerMapMetadata(mappedCustomer?.metadata)
    const customerMetadata = order.customer?.metadata || {}
    const billingAddress = order.billing_address
    const shippingAddress = order.shipping_address
    const preferredAddress = billingAddress || shippingAddress
    const orderMetadata = order.metadata || {}
    const documentoCliente = resolveDocumentoCliente(
        metadata,
        customerMetadata,
        orderMetadata,
        billingAddress?.metadata,
        shippingAddress?.metadata
    )

    return {
        cedula: documentoCliente || "9999999999999",
        razon_social:
            (metadata.razon_social as string | undefined) ||
            `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() ||
            `${preferredAddress?.first_name || ""} ${preferredAddress?.last_name || ""}`.trim() ||
            "CONSUMIDOR FINAL",
        tipo: resolveContificoCustomerType(
            documentoCliente,
            metadata,
            customerMetadata,
            orderMetadata,
            billingAddress?.metadata,
            shippingAddress?.metadata
        ),
        email: order.customer?.email || order.email || "",
        direccion: billingAddress?.address_1 || shippingAddress?.address_1 || "",
        telefonos: billingAddress?.phone || shippingAddress?.phone || "",
        es_extranjero: false,
    }
}

// ── Document / ID resolution ─────────────────────────────

function extractCedulaFromMetadata(metadata: Record<string, unknown> | null | undefined): string | undefined {
    const normalized = String(metadata?.cedula ?? "").replace(/\D/g, "").trim()
    return normalized || undefined
}

function extractRucFromMetadata(metadata: Record<string, unknown> | null | undefined): string | undefined {
    const normalized = String(metadata?.ruc ?? "").replace(/\D/g, "").trim()
    return normalized || undefined
}

function resolveDocumentoCliente(
    ...sources: Array<Record<string, unknown> | null | undefined>
): string | undefined {
    for (const source of sources) {
        const documento = extractCedulaFromMetadata(source) || extractRucFromMetadata(source)
        if (documento) {
            return documento
        }
    }

    return undefined
}

// ── Customer type resolution ─────────────────────────────

function resolveContificoCustomerType(
    documento: string | undefined,
    ...sources: Array<Record<string, unknown> | null | undefined>
): ContificoDocumentoCliente["tipo"] {
    for (const source of sources) {
        const explicitType = normalizeContificoCustomerType(source?.tipo || source?.tipo_persona)
        if (explicitType) {
            return explicitType
        }
    }

    return deriveContificoCustomerTypeFromDocument(documento)
}

function normalizeContificoCustomerType(value: unknown): ContificoDocumentoCliente["tipo"] | undefined {
    if (value === "N" || value === "J" || value === "I" || value === "P") {
        return value
    }

    return undefined
}

function deriveContificoCustomerTypeFromDocument(
    documento: string | undefined
): ContificoDocumentoCliente["tipo"] {
    const normalized = String(documento ?? "").replace(/\D/g, "").trim()

    if (normalized.length === 13) {
        const thirdDigit = Number(normalized[2] || 0)
        if (thirdDigit === 6 || thirdDigit === 9) {
            return "J"
        }
    }

    return "N"
}
