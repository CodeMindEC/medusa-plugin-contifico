/**
 * Utilidades compartidas del plugin Contifico.
 * Centraliza helpers que antes estaban duplicados en múltiples archivos.
 */

/**
 * Retorna `true` si el objeto tiene al menos una key propia.
 * Acepta `null | undefined` para uso directo en guards.
 */
export function hasKeys(value: object | null | undefined): boolean {
    return !!value && Object.keys(value).length > 0
}

/**
 * Convierte un valor desconocido a un número finito, o `null` si no es posible.
 * Acepta `number` y `string` numéricos.
 */
export function asFiniteNumber(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null
    }

    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number.parseFloat(value)
        return Number.isFinite(parsed) ? parsed : null
    }

    return null
}

/**
 * Igual que `asFiniteNumber` pero retorna `null` directamente si el valor es `null | undefined`,
 * sin intentar parsear.
 */
export function asNullableFiniteNumber(value: unknown): number | null {
    if (value == null) {
        return null
    }
    return asFiniteNumber(value)
}

/**
 * Type guard: verifica que `value` sea un `Record<string, unknown>` (objeto plano, no array).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}
