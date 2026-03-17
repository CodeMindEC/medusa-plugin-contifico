import { describe, expect, it } from "vitest"
import { evaluateRule, applyImportFilters } from "./product-filter"

const product = {
    nombre: "Arroz Gustadina 500g",
    codigo: "ARR-001",
    categoria: { nombre: "Granos" },
    pvp1: "2.50",
    descripcion: null,
    stock: "",
}

describe("evaluateRule", () => {
    it("disabled rule always passes", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "equals", value: "X", disabled: true })).toBe(true)
    })

    it("equals (case-insensitive)", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "equals", value: "arroz gustadina 500g" })).toBe(true)
        expect(evaluateRule(product, { field: "nombre", operator: "equals", value: "Otro" })).toBe(false)
    })

    it("not_equals", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "not_equals", value: "X" })).toBe(true)
        expect(evaluateRule(product, { field: "nombre", operator: "not_equals", value: "Arroz Gustadina 500g" })).toBe(false)
    })

    it("contains", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "contains", value: "gustadina" })).toBe(true)
        expect(evaluateRule(product, { field: "nombre", operator: "contains", value: "xyz" })).toBe(false)
    })

    it("not_contains", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "not_contains", value: "xyz" })).toBe(true)
        expect(evaluateRule(product, { field: "nombre", operator: "not_contains", value: "arroz" })).toBe(false)
    })

    it("starts_with", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "starts_with", value: "arroz" })).toBe(true)
        expect(evaluateRule(product, { field: "nombre", operator: "starts_with", value: "xyz" })).toBe(false)
    })

    it("ends_with", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "ends_with", value: "500g" })).toBe(true)
        expect(evaluateRule(product, { field: "nombre", operator: "ends_with", value: "xyz" })).toBe(false)
    })

    it("regex valid", () => {
        expect(evaluateRule(product, { field: "codigo", operator: "regex", value: "^ARR-\\d+" })).toBe(true)
        expect(evaluateRule(product, { field: "codigo", operator: "regex", value: "^ZZZ" })).toBe(false)
    })

    it("regex invalid → false (fail-closed)", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "regex", value: "[invalid(" })).toBe(false)
    })

    it("is_empty on null/empty fields", () => {
        expect(evaluateRule(product, { field: "descripcion", operator: "is_empty" })).toBe(true)
        expect(evaluateRule(product, { field: "stock", operator: "is_empty" })).toBe(true)
        expect(evaluateRule(product, { field: "nombre", operator: "is_empty" })).toBe(false)
    })

    it("is_not_empty", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "is_not_empty" })).toBe(true)
        expect(evaluateRule(product, { field: "descripcion", operator: "is_not_empty" })).toBe(false)
    })

    it("greater_than / less_than", () => {
        expect(evaluateRule(product, { field: "pvp1", operator: "greater_than", value: "2" })).toBe(true)
        expect(evaluateRule(product, { field: "pvp1", operator: "greater_than", value: "3" })).toBe(false)
        expect(evaluateRule(product, { field: "pvp1", operator: "less_than", value: "3" })).toBe(true)
        expect(evaluateRule(product, { field: "pvp1", operator: "less_than", value: "1" })).toBe(false)
    })

    it("greater_than with NaN → true (does not filter)", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "greater_than", value: "5" })).toBe(true)
    })

    it("nested field with dot notation", () => {
        expect(evaluateRule(product, { field: "categoria.nombre", operator: "equals", value: "Granos" })).toBe(true)
        expect(evaluateRule(product, { field: "categoria.nombre", operator: "equals", value: "Otro" })).toBe(false)
    })

    it("nested field on null parent → empty string", () => {
        expect(evaluateRule(product, { field: "noexiste.sub", operator: "is_empty" })).toBe(true)
    })

    it("unknown operator → true (safe fallback)", () => {
        expect(evaluateRule(product, { field: "nombre", operator: "FUTURE_OP" as any, value: "x" })).toBe(true)
    })
})

describe("applyImportFilters", () => {
    const products = [
        { nombre: "Arroz 1kg", pvp1: "3.00" },
        { nombre: "Fideo Largo", pvp1: "1.50" },
        { nombre: "Arroz 500g", pvp1: "1.80" },
    ]

    it("null config → returns all", () => {
        expect(applyImportFilters(products, null)).toEqual(products)
    })

    it("empty rules → returns all", () => {
        expect(applyImportFilters(products, { mode: "and", rules: [] })).toEqual(products)
    })

    it("all rules disabled → returns all", () => {
        expect(
            applyImportFilters(products, {
                mode: "and",
                rules: [{ field: "nombre", operator: "equals", value: "X", disabled: true }],
            })
        ).toEqual(products)
    })

    it("AND mode: all rules must match", () => {
        const result = applyImportFilters(products, {
            mode: "and",
            rules: [
                { field: "nombre", operator: "contains", value: "arroz" },
                { field: "pvp1", operator: "greater_than", value: "2" },
            ],
        })
        expect(result).toEqual([{ nombre: "Arroz 1kg", pvp1: "3.00" }])
    })

    it("OR mode: any rule matches", () => {
        const result = applyImportFilters(products, {
            mode: "or",
            rules: [
                { field: "nombre", operator: "equals", value: "Fideo Largo" },
                { field: "pvp1", operator: "greater_than", value: "2" },
            ],
        })
        expect(result).toEqual([
            { nombre: "Arroz 1kg", pvp1: "3.00" },
            { nombre: "Fideo Largo", pvp1: "1.50" },
        ])
    })
})
