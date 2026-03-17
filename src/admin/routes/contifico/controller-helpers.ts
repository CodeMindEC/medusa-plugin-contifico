export function getErrorDescription(error: unknown): string {
    return error instanceof Error ? error.message : "Error desconocido"
}

export async function parseJsonResponse<TData>(response: Response): Promise<TData> {
    return response.json() as Promise<TData>
}

export function isInvoicePreviewType(value: string): value is "PRE" | "FAC" {
    return value === "PRE" || value === "FAC"
}
