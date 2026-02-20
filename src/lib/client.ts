import type {
    ContificoPaginatedResponse,
    ContificoProducto,
    ContificoProductoCreate,
    ContificoCategoria,
    ContificoCategoriaV1,
    ContificoBodega,
    ContificoStockBodega,
    ContificoVariante,
    ContificoPersona,
    ContificoPersonaCreate,
    ContificoDocumento,
    ContificoDocumentoCreate,
    ContificoDocumentoEstado,
    ContificoCobro,
    ContificoCobroCreate,
    ContificoFormaPago,
    ContificoMovimientoInventario,
} from "./types"

const BASE_URL_V2 = "https://api.contifico.com/sistema/api/v2"
const BASE_URL_V1 = "https://api.contifico.com/sistema/api/v1"

interface ClientOptions {
    apiKey: string
    /** Token POS (necesario para crear documentos) */
    apiPos?: string
    /** Timeout en ms (default 15000) */
    timeout?: number
    /** Reintentos (default 2) */
    retries?: number
}

interface RequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE"
    body?: unknown
    params?: Record<string, string>
    /** Usar v1 en vez de v2 */
    useV1?: boolean
}

export class ContificoClient {
    private apiKey: string
    private apiPos?: string
    private timeout: number
    private retries: number

    constructor(options: ClientOptions) {
        this.apiKey = options.apiKey
        this.apiPos = options.apiPos
        this.timeout = options.timeout ?? 15000
        this.retries = options.retries ?? 2
    }

    // ── Helpers ──────────────────────────────────────────────

    private async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
        const { method = "GET", body, params, useV1 = false } = opts
        const base = useV1 ? BASE_URL_V1 : BASE_URL_V2
        let url = `${base}${path}`

        if (params) {
            const qs = new URLSearchParams(params).toString()
            url += `?${qs}`
        }

        let lastError: Error | null = null

        for (let attempt = 0; attempt <= this.retries; attempt++) {
            try {
                const controller = new AbortController()
                const timer = setTimeout(() => controller.abort(), this.timeout)

                const res = await fetch(url, {
                    method,
                    headers: {
                        Authorization: this.apiKey,
                        "Content-Type": "application/json",
                    },
                    body: body ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                })

                clearTimeout(timer)

                if (!res.ok) {
                    const errorBody = await res.text()
                    throw new Error(
                        `Contifico API ${method} ${path} responded ${res.status}: ${errorBody}`
                    )
                }

                if (res.status === 204) {
                    return undefined as T
                }

                return (await res.json()) as T
            } catch (err) {
                lastError = err as Error
                if (attempt < this.retries && !String(err).includes("400")) {
                    await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)))
                    continue
                }
                break
            }
        }

        throw lastError
    }

    /**
     * Helper para obtener TODOS los resultados paginados de v2.
     * Sigue `next` hasta que no haya mas paginas.
     */
    private async getAllPaginated<T>(
        path: string,
        params?: Record<string, string>
    ): Promise<T[]> {
        const first = await this.request<ContificoPaginatedResponse<T>>(path, {
            params,
        })

        const results = [...first.results]

        let nextUrl = first.next
        while (nextUrl) {
            const res = await fetch(nextUrl, {
                headers: {
                    Authorization: this.apiKey,
                    "Content-Type": "application/json",
                },
            })
            if (!res.ok) break
            const page = (await res.json()) as ContificoPaginatedResponse<T>
            results.push(...page.results)
            nextUrl = page.next
        }

        return results
    }

    // ── Productos (v2, paginado) ─────────────────────────────

    async getProductos(
        params?: Record<string, string>
    ): Promise<ContificoPaginatedResponse<ContificoProducto>> {
        return this.request<ContificoPaginatedResponse<ContificoProducto>>(
            "/producto/",
            { params }
        )
    }

    async getAllProductos(
        params?: Record<string, string>
    ): Promise<ContificoProducto[]> {
        return this.getAllPaginated<ContificoProducto>("/producto/", params)
    }

    async getProducto(id: string): Promise<ContificoProducto> {
        return this.request<ContificoProducto>(`/producto/${id}/`)
    }

    async getProductoPorCodigo(codigo: string): Promise<ContificoProducto[]> {
        const res = await this.getProductos({ codigo })
        return res.results
    }

    async createProducto(
        data: ContificoProductoCreate
    ): Promise<ContificoProducto> {
        return this.request<ContificoProducto>("/producto/", {
            method: "POST",
            body: data,
        })
    }

    async updateProducto(
        id: string,
        data: Partial<ContificoProductoCreate>
    ): Promise<ContificoProducto> {
        return this.request<ContificoProducto>(`/producto/${id}/`, {
            method: "PUT",
            body: data,
        })
    }

    // ── Categorias ───────────────────────────────────────────

    /** Categorias v2 (simplificadas, paginadas) */
    async getCategorias(): Promise<ContificoPaginatedResponse<ContificoCategoria>> {
        return this.request<ContificoPaginatedResponse<ContificoCategoria>>(
            "/categoria/"
        )
    }

    async getAllCategorias(): Promise<ContificoCategoria[]> {
        return this.getAllPaginated<ContificoCategoria>("/categoria/")
    }

    /** Categorias v1 (mas completas, array plano) */
    async getCategoriasV1(): Promise<ContificoCategoriaV1[]> {
        return this.request<ContificoCategoriaV1[]>("/categoria/", {
            useV1: true,
        })
    }

    async getCategoria(id: string): Promise<ContificoCategoria> {
        return this.request<ContificoCategoria>(`/categoria/${id}/`)
    }

    // ── Bodegas (v2, paginado) ───────────────────────────────

    async getBodegas(): Promise<ContificoPaginatedResponse<ContificoBodega>> {
        return this.request<ContificoPaginatedResponse<ContificoBodega>>(
            "/bodega/"
        )
    }

    async getAllBodegas(): Promise<ContificoBodega[]> {
        return this.getAllPaginated<ContificoBodega>("/bodega/")
    }

    // ── Stock (v2: /producto/{id}/stock/) ────────────────────

    async getStock(
        productoId: string
    ): Promise<ContificoPaginatedResponse<ContificoStockBodega>> {
        return this.request<ContificoPaginatedResponse<ContificoStockBodega>>(
            `/producto/${productoId}/stock/`
        )
    }

    async getStockAll(productoId: string): Promise<ContificoStockBodega[]> {
        // El endpoint de stock puede devolver un array plano o paginado
        const raw = await this.request<
            | ContificoStockBodega[]
            | ContificoPaginatedResponse<ContificoStockBodega>
        >(`/producto/${productoId}/stock/`)

        // Si es array directo, devolverlo
        if (Array.isArray(raw)) {
            return raw
        }

        // Si es paginado, iterar páginas
        if (raw && typeof raw === "object" && "results" in raw) {
            const results = [...raw.results]
            let nextUrl = raw.next
            while (nextUrl) {
                const res = await fetch(nextUrl, {
                    headers: {
                        Authorization: this.apiKey,
                        "Content-Type": "application/json",
                    },
                })
                if (!res.ok) break
                const page =
                    (await res.json()) as ContificoPaginatedResponse<ContificoStockBodega>
                results.push(...page.results)
                nextUrl = page.next
            }
            return results
        }

        return []
    }

    // ── Variantes (solo v1 — no existe en v2) ────────────────

    async getVariantes(): Promise<ContificoVariante[]> {
        return this.request<ContificoVariante[]>("/variante/", { useV1: true })
    }

    async getVarianteById(id: string): Promise<ContificoVariante> {
        return this.request<ContificoVariante>(`/variante/${id}/`, {
            useV1: true,
        })
    }

    // ── Personas (v2, paginado) ──────────────────────────────

    async getPersonas(
        params?: Record<string, string>
    ): Promise<ContificoPaginatedResponse<ContificoPersona>> {
        return this.request<ContificoPaginatedResponse<ContificoPersona>>(
            "/persona/",
            { params }
        )
    }

    async getAllPersonas(
        params?: Record<string, string>
    ): Promise<ContificoPersona[]> {
        return this.getAllPaginated<ContificoPersona>("/persona/", params)
    }

    async getPersona(id: string): Promise<ContificoPersona> {
        return this.request<ContificoPersona>(`/persona/${id}/`)
    }

    async getPersonaPorIdentificacion(
        identificacion: string
    ): Promise<ContificoPersona[]> {
        const res = await this.getPersonas({ identificacion })
        return res.results
    }

    async buscarPersona(search: string): Promise<ContificoPersona[]> {
        const res = await this.getPersonas({ search })
        return res.results
    }

    async createPersona(
        data: ContificoPersonaCreate
    ): Promise<ContificoPersona> {
        return this.request<ContificoPersona>("/persona/", {
            method: "POST",
            body: data,
        })
    }

    async updatePersona(
        id: string,
        data: Partial<ContificoPersonaCreate>
    ): Promise<ContificoPersona> {
        return this.request<ContificoPersona>(`/persona/${id}/`, {
            method: "PUT",
            body: data,
        })
    }

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

    /**
     * Crea un documento (factura, prefactura, NC, etc.) en Contifico.
     * IMPORTANTE: `pos` es REQUIRED por la API v2. Si no viene en `data`,
     * se inyecta automaticamente desde `this.apiPos`.
     */
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
        return this.request<ContificoDocumento>(`/documento/${id}/`, {
            method: "PUT",
            body: data,
        })
    }

    /**
     * Anula un documento en Contifico.
     * El PUT requiere TODOS los campos obligatorios, así que primero
     * obtenemos el doc actual y lo reenviamos con estado=A + anulado=true.
     */
    async anularDocumento(id: string): Promise<ContificoDocumento> {
        const doc = await this.getDocumento(id)

        // Reconstruir detalles en el formato que espera el PUT
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
                fecha_emision: doc.fecha_emision,
                hora_emision: doc.hora_emision ?? undefined,
                tipo_registro: doc.tipo_registro,
                tipo_documento: doc.tipo_documento,
                documento: doc.documento,
                electronico: doc.electronico,
                autorizacion: doc.autorizacion,
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
                detalles,
                estado: "A",
                anulado: true,
            },
        })
    }

    // ── Estado de documento electronico (v2) ─────────────────

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

    /**
     * Crea un cobro para un documento.
     * NOTA: Solo funciona en documentos creados via API, no en los
     * creados desde la web de Contifico.
     */
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

    // ── Movimientos de inventario (v2) ───────────────────────

    async getMovimientos(
        params?: Record<string, string>
    ): Promise<ContificoPaginatedResponse<ContificoMovimientoInventario>> {
        return this.request<
            ContificoPaginatedResponse<ContificoMovimientoInventario>
        >("/movimiento-inventario/", { params })
    }

    // ── Utilidades ───────────────────────────────────────────

    /**
     * Comprueba la conexion a Contifico obteniendo las bodegas.
     * Si falla, lanza error con mensaje descriptivo.
     */
    async testConnection(): Promise<{ ok: boolean; bodegas: number }> {
        const res = await this.getBodegas()
        return { ok: true, bodegas: res.count }
    }
}
