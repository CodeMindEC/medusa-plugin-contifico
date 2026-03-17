import { WEIGHTED_PVP_FIELD_VALUES } from "../../../lib/contifico-config"
import { WEIGHTED_PRICE_STRATEGIES } from "../../../lib/weighted-price-strategies"
import type { WeightedPresentationProfile } from "../../../lib/weighted-presentation-profiles"
import type { SelectOption } from "./components/ui-select-field"

export const MAPPING_MODE_OPTIONS: SelectOption[] = [
    { value: "auto", label: "Automático" },
    { value: "contifico", label: "Variantes de Contifico" },
    { value: "simple", label: "Variante única" },
    { value: "weighted", label: "Producto base por peso" },
]

export const INVOICE_TYPE_OPTIONS: SelectOption[] = [
    { value: "FAC", label: "Factura" },
    { value: "PRE", label: "Prefactura" },
]

export const INVOICE_STATUS_FILTER_OPTIONS: SelectOption[] = [
    { value: "ALL", label: "Todos" },
    { value: "P", label: "Pendiente (P)" },
    { value: "C", label: "Cobrado (C)" },
    { value: "A", label: "Anulado (A)" },
]

export const INVOICE_TYPE_FILTER_OPTIONS: SelectOption[] = [
    { value: "ALL", label: "Todos" },
    { value: "FAC", label: "Factura" },
    { value: "PRE", label: "Prefactura" },
]

export const WEIGHTED_CREATION_MODE_OPTIONS: SelectOption[] = [
    { value: "manual_only", label: "Solo manual" },
    { value: "presentation_profile", label: "Perfiles de presentación" },
]

export const WEIGHTED_PVP_OPTIONS: SelectOption[] =
    WEIGHTED_PVP_FIELD_VALUES.map((field) => ({
        value: field,
        label: field.toUpperCase(),
    }))

export const WEIGHTED_PRICE_STRATEGY_OPTIONS: SelectOption[] =
    WEIGHTED_PRICE_STRATEGIES.map((strategy) => ({
        value: strategy.id,
        label: strategy.label,
    }))

export function mapNamedOptions<TItem extends { id: string; name: string }>(
    items: TItem[]
): SelectOption[] {
    return items.map((item) => ({
        value: item.id,
        label: item.name,
    }))
}

export function getWeightedCreationProfileOptions(
    profiles: WeightedPresentationProfile[]
): SelectOption[] {
    return [
        { value: "__NONE__", label: "Sin perfil por defecto" },
        ...profiles.map((profile) => ({
            value: profile.id,
            label: profile.name,
        })),
    ]
}
