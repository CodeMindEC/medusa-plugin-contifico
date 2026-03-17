import type { ContificoPaginatedResponse } from "../types"

const BASE_URL_V2 = "https://api.contifico.com/sistema/api/v2"
const BASE_URL_V1 = "https://api.contifico.com/sistema/api/v1"

export interface ClientOptions {
    apiKey: string
    /** Token POS (necesario para crear documentos) */
    apiPos?: string
    /** Timeout en ms (default 15000) */
    timeout?: number
    /** Reintentos (default 2) */
    retries?: number
}

export interface RequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE"
    body?: unknown
    params?: Record<string, string>
    /** Usar v1 en vez de v2 */
    useV1?: boolean
}

export class ContificoBaseClient {
    protected apiKey: string
    protected apiPos?: string
    protected timeout: number
    protected retries: number

    constructor(options: ClientOptions) {
        this.apiKey = options.apiKey
        this.apiPos = options.apiPos
        this.timeout = options.timeout ?? 15000
        this.retries = options.retries ?? 2
    }

    // ── Core request helpers ─────────────────────────────────

    protected async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
        const { useV1 = false } = opts
        return this.requestUrl<T>(this.buildUrl(path, useV1, opts.params), opts)
    }

    private buildUrl(
        path: string,
        useV1: boolean,
        params?: Record<string, string>
    ): string {
        const base = useV1 ? BASE_URL_V1 : BASE_URL_V2
        const query = params ? `?${new URLSearchParams(params).toString()}` : ""
        return `${base}${path}${query}`
    }

    protected async requestUrl<T>(url: string, opts: RequestOptions = {}): Promise<T> {
        const { method = "GET", body } = opts
        let lastError: Error | null = null

        for (let attempt = 0; attempt <= this.retries; attempt++) {
            try {
                return await this.fetchJson<T>(url, method, body)
            } catch (err) {
                lastError = err as Error
                const is4xx = String(err).includes("400") || String(err).includes("404")
                if (attempt < this.retries && !is4xx) {
                    // Backoff exponencial con jitter
                    const base = 500 * Math.pow(2, attempt)
                    const jitter = base * (0.5 + Math.random() * 0.5)
                    await new Promise((r) => setTimeout(r, jitter))
                    continue
                }
                break
            }
        }

        throw lastError
    }

    private async fetchJson<T>(
        url: string,
        method: RequestOptions["method"],
        body?: unknown
    ): Promise<T> {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.timeout)

        try {
            const res = await fetch(url, {
                method,
                headers: {
                    Authorization: this.apiKey,
                    "Content-Type": "application/json",
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            })

            if (!res.ok) {
                const errorBody = await res.text()
                throw new Error(
                    `Contifico API ${method} ${url} responded ${res.status}: ${errorBody}`
                )
            }

            if (res.status === 204) {
                return undefined as T
            }

            return (await res.json()) as T
        } finally {
            clearTimeout(timer)
        }
    }

    /**
     * Obtiene TODOS los resultados paginados de v2.
     * Sigue `next` hasta que no haya más páginas.
     */
    protected async getAllPaginated<T>(
        path: string,
        params?: Record<string, string>
    ): Promise<T[]> {
        const firstPage = await this.request<ContificoPaginatedResponse<T>>(path, {
            params,
        })
        return this.collectPaginatedResults(firstPage)
    }

    protected async collectPaginatedResults<T>(
        firstPage: ContificoPaginatedResponse<T>
    ): Promise<T[]> {
        const results = [...firstPage.results]
        let nextUrl = firstPage.next

        while (nextUrl) {
            const page = await this.requestUrl<ContificoPaginatedResponse<T>>(nextUrl)
            results.push(...page.results)
            nextUrl = page.next
        }

        return results
    }
}
