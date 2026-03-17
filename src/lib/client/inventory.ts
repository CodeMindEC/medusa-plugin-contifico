import type {
    ContificoPaginatedResponse,
    ContificoBodega,
    ContificoStockBodega,
    ContificoMovimientoInventario,
} from "../types"
import { ContificoBaseClient } from "./base"

export class ContificoInventoryClient extends ContificoBaseClient {
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
        const raw = await this.request<
            | ContificoStockBodega[]
            | ContificoPaginatedResponse<ContificoStockBodega>
        >(`/producto/${productoId}/stock/`)

        if (Array.isArray(raw)) {
            return raw
        }

        if (raw && typeof raw === "object" && "results" in raw) {
            return this.collectPaginatedResults(raw)
        }

        return []
    }

    // ── Movimientos de inventario (v2) ───────────────────────

    async getMovimientos(
        params?: Record<string, string>
    ): Promise<ContificoPaginatedResponse<ContificoMovimientoInventario>> {
        return this.request<
            ContificoPaginatedResponse<ContificoMovimientoInventario>
        >("/movimiento-inventario/", { params })
    }
}
