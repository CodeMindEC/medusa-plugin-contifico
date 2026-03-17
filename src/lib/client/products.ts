import type {
    ContificoPaginatedResponse,
    ContificoProducto,
    ContificoProductoCreate,
    ContificoCategoria,
    ContificoCategoriaV1,
    ContificoVariante,
} from "../types"
import { ContificoBaseClient } from "./base"

export class ContificoProductsClient extends ContificoBaseClient {
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
            body: { pos: this.apiPos, ...data },
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

    // ── Categorías ───────────────────────────────────────────

    async getCategorias(): Promise<ContificoPaginatedResponse<ContificoCategoria>> {
        return this.request<ContificoPaginatedResponse<ContificoCategoria>>(
            "/categoria/"
        )
    }

    async getAllCategorias(): Promise<ContificoCategoria[]> {
        return this.getAllPaginated<ContificoCategoria>("/categoria/")
    }

    async getCategoriasV1(): Promise<ContificoCategoriaV1[]> {
        return this.request<ContificoCategoriaV1[]>("/categoria/", {
            useV1: true,
        })
    }

    async getCategoria(id: string): Promise<ContificoCategoria> {
        return this.request<ContificoCategoria>(`/categoria/${id}/`)
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
}
