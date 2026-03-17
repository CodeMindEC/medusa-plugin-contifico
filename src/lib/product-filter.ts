/**
 * Motor de filtros para importación de productos de Contifico.
 *
 * Dev-friendly: para agregar un nuevo operador:
 *   1. Agregar la entrada al tipo `FilterOperator`
 *   2. Agregar el case en `evaluateRule()`
 *   3. Agregar metadata en `FILTER_OPERATORS`
 */

import {
    describeImportFilterRule,
    type ImportFilterConfig,
    type ImportFilterRule,
} from "./contifico-filters"

export type { FilterOperator, ImportFilterConfig, ImportFilterRule } from "./contifico-filters"
export {
    FILTERABLE_FIELDS,
    FILTER_OPERATORS,
    FILTER_OPERATOR_VALUES,
} from "./contifico-filters"

// ── Funciones ──────────────────────────────────────────────

/**
 * Extrae el valor de un campo de un objeto producto.
 * Soporta campos anidados con notación de punto (ej: "marca.nombre").
 */
function getFieldValue(product: Record<string, unknown>, field: string): string | null | undefined {
    if (field.includes(".")) {
        const parts = field.split(".")
        let current: unknown = product
        for (const part of parts) {
            if (current == null || typeof current !== "object") return undefined
            current = (current as Record<string, unknown>)[part]
        }
        return current == null ? null : String(current)
    }
    const raw = product[field]
    return raw == null ? null : String(raw)
}

/**
 * Evalúa una regla contra un producto.
 * Retorna `true` si el producto CUMPLE la condición.
 */
export function evaluateRule(
    product: Record<string, unknown>,
    rule: ImportFilterRule
): boolean {
    if (rule.disabled) return true // regla desactivada = pasa siempre

    const raw = getFieldValue(product, rule.field)
    const value = raw ?? ""
    const target = rule.value ?? ""

    switch (rule.operator) {
        case "equals":
            return value.toLowerCase() === target.toLowerCase()

        case "not_equals":
            return value.toLowerCase() !== target.toLowerCase()

        case "contains":
            return value.toLowerCase().includes(target.toLowerCase())

        case "not_contains":
            return !value.toLowerCase().includes(target.toLowerCase())

        case "starts_with":
            return value.toLowerCase().startsWith(target.toLowerCase())

        case "ends_with":
            return value.toLowerCase().endsWith(target.toLowerCase())

        case "regex":
            try {
                return new RegExp(target, "i").test(value)
            } catch {
                // Regex invalida -> no filtra (seguro)
                return true
            }

        case "is_empty":
            return raw == null || raw === "" || raw === "null"

        case "is_not_empty":
            return raw != null && raw !== "" && raw !== "null"

        case "greater_than": {
            const numVal = parseFloat(value)
            const numTarget = parseFloat(target)
            if (isNaN(numVal) || isNaN(numTarget)) return true
            return numVal > numTarget
        }

        case "less_than": {
            const numVal = parseFloat(value)
            const numTarget = parseFloat(target)
            if (isNaN(numVal) || isNaN(numTarget)) return true
            return numVal < numTarget
        }

        default:
            // Operador desconocido -> no filtra (seguro)
            return true
    }
}

/**
 * Aplica todos los filtros a un array de productos.
 * Si `config` es null o sin reglas, retorna todos los productos.
 */
export function applyImportFilters<T>(
    products: T[],
    config: ImportFilterConfig | null
): T[] {
    if (!config || !config.rules || config.rules.length === 0) {
        return products
    }

    const activeRules = config.rules.filter((r) => !r.disabled)
    if (activeRules.length === 0) return products

    return products.filter((product) => {
        const prodRecord = product as Record<string, unknown>
        if (config.mode === "or") {
            return activeRules.some((rule) => evaluateRule(prodRecord, rule))
        }
        // AND (default)
        return activeRules.every((rule) => evaluateRule(prodRecord, rule))
    })
}

/**
 * Genera un texto descriptivo legible para una regla (para la UI).
 */
export function describeRule(rule: ImportFilterRule): string {
    return describeImportFilterRule(rule)
}
