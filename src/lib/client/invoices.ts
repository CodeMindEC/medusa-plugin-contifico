import type {
    ContificoPaginatedResponse,
    ContificoDocumento,
    ContificoDocumentoCreate,
    ContificoDocumentoEstado,
    ContificoCobro,
    ContificoCobroCreate,
    ContificoFormaPago,
} from "../types"
import { ContificoBaseClient } from "./base"

export class ContificoInvoicesClient extends ContificoBaseClient {
    // ── Documentos (v2, paginado) ────────────────────────────

    async getDocumentos(
        params?: Record<string, string>
    ): Promise<ContificoPaginatedResponse<ContificoDocumento>> {
        return this.request<ContificoPaginatedResponse<ContificoDocumento>>(
            "/documento/",
            { params }
        )
    }

    async getAllDocumentos(
        params?: Record<string, string>
    ): Promise<ContificoDocumento[]> {
        return this.getAllPaginated<ContificoDocumento>("/documento/", params)
    }

    async getDocumento(id: string): Promise<ContificoDocumento> {
        return this.request<ContificoDocumento>(`/documento/${id}/`)
    }

    async createDocumento(
        data: ContificoDocumentoCreate
    ): Promise<ContificoDocumento> {
        const payload = { ...data }
        if (!payload.pos && this.apiPos) {
            payload.pos = this.apiPos
        }
        if (!payload.pos) {
            throw new Error(
                "Contifico: 'pos' (API Token del POS) es obligatorio para crear documentos. " +
                "Configuralo en apiPos del client o incluyelo en el payload."
            )
        }
        return this.request<ContificoDocumento>("/documento/", {
            method: "POST",
            body: payload,
        })
    }

    async updateDocumento(
        id: string,
        data: Partial<ContificoDocumentoCreate>
    ): Promise<ContificoDocumento> {
        const payload = { ...data }
        if (!payload.pos && this.apiPos) {
            payload.pos = this.apiPos
        }
        if (!payload.pos) {
            throw new Error(
                "Contifico: 'pos' (API Token del POS) es obligatorio para crear documentos. " +
                "Configuralo en apiPos del client o incluyelo en el payload."
            )
        }

        return this.request<ContificoDocumento>(`/documento/${id}/`, {
            method: "PUT",
            body: payload,
        })
    }

    async anularDocumento(id: string): Promise<ContificoDocumento> {
        const doc = await this.getDocumento(id)

        const detalles = (doc.detalles || []).map((d) => ({
            producto_id: d.producto_id,
            cantidad: d.cantidad,
            precio: d.precio,
            porcentaje_iva: d.porcentaje_iva ?? 0,
            porcentaje_descuento: d.porcentaje_descuento ?? 0,
            base_gravable: d.base_gravable ?? 0,
            base_cero: d.base_cero ?? 0,
            base_no_gravable: d.base_no_gravable ?? 0,
            descripcion: d.descripcion ?? "",
            serie: d.serie ?? "",
        }))

        return this.request<ContificoDocumento>(`/documento/${id}/`, {
            method: "PUT",
            body: {
                pos: doc.pos || this.apiPos,
                fecha_emision: doc.fecha_emision,
                hora_emision: doc.hora_emision ?? undefined,
                tipo_registro: doc.tipo_registro,
                tipo_documento: doc.tipo_documento,
                documento: doc.documento,
                electronico: doc.electronico,
                autorizacion: doc.autorizacion || "0000000000",
                reserva_relacionada: doc.reserva_relacionada ?? null,
                subtotal_12: doc.subtotal_12,
                subtotal_0: doc.subtotal_0,
                iva: doc.iva,
                ice: doc.ice ?? "0",
                servicio: doc.servicio ?? "0",
                total: doc.total,
                descripcion: doc.descripcion,
                referencia: doc.referencia,
                adicional1: doc.adicional1,
                adicional2: doc.adicional2,
                persona_id: doc.persona_id,
                cliente: doc.cliente,
                detalles,
                estado: "A",
                anulado: true,
            },
        })
    }

    // ── Estado de documento electrónico (v2) ─────────────────

    async getDocumentoEstado(
        id: string
    ): Promise<ContificoDocumentoEstado> {
        return this.request<ContificoDocumentoEstado>(
            `/documento/estado/${id}/`
        )
    }

    // ── Cobros de un documento (v2) ──────────────────────────

    async getCobros(
        documentoId: string,
        params?: Record<string, string>
    ): Promise<ContificoPaginatedResponse<ContificoCobro>> {
        return this.request<ContificoPaginatedResponse<ContificoCobro>>(
            `/documento/${documentoId}/cobro/`,
            { params }
        )
    }

    async createCobro(
        documentoId: string,
        data: ContificoCobroCreate
    ): Promise<ContificoCobro> {
        return this.request<ContificoCobro>(
            `/documento/${documentoId}/cobro/`,
            { method: "POST", body: data }
        )
    }

    // ── Formas de pago de un documento (v2) ──────────────────

    async getFormasPago(
        documentoId: string
    ): Promise<ContificoFormaPago> {
        return this.request<ContificoFormaPago>(
            `/documento/${documentoId}/forma_pago/`
        )
    }
}
