/**
 * Shared utility functions for the invoice-documents module.
 * Small, pure helpers used across invoice-documents-*, invoice-idempotency, etc.
 */

import type { ContificoDocumento } from "../types"
import type { InvoiceDocumentSummary } from "./invoice-documents"

// ── Constants ────────────────────────────────────────────
export const REMOTE_DOCUMENT_SEARCH_PAGE_SIZE = 100
export const REMOTE_DOCUMENT_SEARCH_MAX_PAGES = 10
export const REMOTE_DOCUMENT_SEARCH_WINDOW_DAYS = 365
export const ACTIVE_INVOICE_MAP_CONFLICT_ERROR = "contifico_active_invoice_map_conflict"

// ── Functions ────────────────────────────────────────────

export function serializeInvoiceDocument(
    documento: ContificoDocumento,
    tipoDocumento: "PRE" | "FAC",
    referencia: string,
    isTest: boolean
) {
    return {
        id: documento.id,
        tipo_documento: tipoDocumento,
        referencia,
        estado: documento.estado,
        total: documento.total,
        documento: documento.documento || null,
        url_ride: documento.url_ride || null,
        url_xml: documento.url_xml || null,
        created_at: documento.fecha_creacion || null,
        client_name: extractDocumentClientName(documento),
        client_identification: extractDocumentClientIdentification(documento),
        test: isTest,
    }
}

export function emptyInvoiceDocumentSummary(): InvoiceDocumentSummary {
    return {
        exists: false,
        source: "none",
        contifico_id: null,
        referencia: null,
        estado: null,
        total: null,
        documento: null,
        url_ride: null,
        url_xml: null,
        created_at: null,
        client_name: null,
        client_identification: null,
        is_test: false,
        estado_electronico: null,
    }
}

export function extractDocumentClientName(
    documento: Pick<ContificoDocumento, "cliente" | "persona"> | null | undefined
): string | null {
    return (
        documento?.cliente?.razon_social ||
        documento?.persona?.razon_social ||
        null
    )
}

export function extractDocumentClientIdentification(
    documento: Pick<ContificoDocumento, "cliente" | "persona"> | null | undefined
): string | null {
    return (
        documento?.cliente?.cedula ||
        documento?.persona?.ruc ||
        documento?.persona?.cedula ||
        null
    )
}

export function formatContificoDate(date: Date): string {
    return `${String(date.getDate()).padStart(2, "0")}/${String(
        date.getMonth() + 1
    ).padStart(2, "0")}/${date.getFullYear()}`
}

export function daysAgo(days: number) {
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date
}

export function normalizeReference(reference: string | null | undefined): string {
    return String(reference || "").trim()
}

export function isActiveInvoiceMapConflictError(error: unknown): boolean {
    return error instanceof Error && error.message === ACTIVE_INVOICE_MAP_CONFLICT_ERROR
}
