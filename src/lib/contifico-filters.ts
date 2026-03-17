export const FILTER_OPERATOR_VALUES = [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "regex",
    "is_empty",
    "is_not_empty",
    "greater_than",
    "less_than",
] as const

export type FilterOperator = (typeof FILTER_OPERATOR_VALUES)[number]

export interface ImportFilterRule {
    field: string
    operator: FilterOperator
    value?: string
    label?: string
    disabled?: boolean
}

export interface ImportFilterConfig {
    mode: "and" | "or"
    rules: ImportFilterRule[]
}

export interface FilterOperatorDefinition {
    label_es: string
    needsValue: boolean
}

export interface FilterableFieldDefinition {
    value: string
    label: string
}

export const FILTER_OPERATORS: Record<
    FilterOperator,
    FilterOperatorDefinition
> = {
    equals: { label_es: "es igual a", needsValue: true },
    not_equals: { label_es: "no es igual a", needsValue: true },
    contains: { label_es: "contiene", needsValue: true },
    not_contains: { label_es: "no contiene", needsValue: true },
    starts_with: { label_es: "empieza con", needsValue: true },
    ends_with: { label_es: "termina con", needsValue: true },
    regex: { label_es: "cumple regex", needsValue: true },
    is_empty: { label_es: "esta vacio", needsValue: false },
    is_not_empty: { label_es: "no esta vacio", needsValue: false },
    greater_than: { label_es: "mayor que", needsValue: true },
    less_than: { label_es: "menor que", needsValue: true },
}

export const FILTERABLE_FIELDS: FilterableFieldDefinition[] = [
    { value: "nombre", label: "Nombre" },
    { value: "codigo", label: "Codigo" },
    { value: "tipo_producto", label: "Tipo producto (SIM/COM/PRO/COP)" },
    { value: "tipo", label: "Tipo (PRO/SER)" },
    { value: "estado", label: "Estado (A/I)" },
    { value: "categoria_id", label: "Categoria ID" },
    { value: "pvp1", label: "PVP1" },
    { value: "pvp2", label: "PVP2" },
    { value: "pvp3", label: "PVP3" },
    { value: "pvp4", label: "PVP4" },
    { value: "marca_nombre", label: "Marca" },
    { value: "marca_id", label: "Marca ID" },
    { value: "descripcion", label: "Descripcion" },
    { value: "cantidad_stock", label: "Cantidad Stock" },
    { value: "codigo_barra", label: "Codigo de barras" },
    { value: "codigo_auxiliar", label: "Codigo auxiliar" },
    { value: "personalizado1", label: "Personalizado 1" },
    { value: "personalizado2", label: "Personalizado 2" },
    { value: "unidad", label: "Unidad" },
    { value: "minimo", label: "Minimo" },
    { value: "para_pos", label: "Para POS" },
    { value: "producto_base_id", label: "Producto base ID" },
    { value: "nombre_producto_base", label: "Nombre producto base" },
    { value: "codigo_proveedor", label: "Codigo proveedor" },
]

export function describeImportFilterRule(rule: ImportFilterRule): string {
    const fieldMeta = FILTERABLE_FIELDS.find((field) => field.value === rule.field)
    const operatorMeta = FILTER_OPERATORS[rule.operator]

    if (!operatorMeta?.needsValue) {
        return `"${fieldMeta?.label || rule.field}" ${operatorMeta?.label_es || rule.operator}`
    }

    return `"${fieldMeta?.label || rule.field}" ${operatorMeta?.label_es || rule.operator} "${rule.value || ""}"`
}
