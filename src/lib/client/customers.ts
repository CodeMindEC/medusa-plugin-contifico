import type {
    ContificoPaginatedResponse,
    ContificoPersona,
    ContificoPersonaCreate,
} from "../types"
import { ContificoBaseClient } from "./base"

export class ContificoCustomersClient extends ContificoBaseClient {
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
}
