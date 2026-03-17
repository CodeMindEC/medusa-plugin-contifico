import {
    WEIGHTED_PVP_FIELD_VALUES,
    type VariantMode,
    type WeightedPvpField,
} from "../../../../lib/contifico-config"
import type { EffectiveProductRules } from "../../../../lib/advanced-settings"
import { Badge, Select, Text } from "@medusajs/ui"
import type { ProductLinkOrigin } from "../../../../lib/contifico-metadata"

export interface ProductMatch {
    contifico_id: string
    contifico_nombre: string
    contifico_codigo: string
    contifico_imagen?: string | null
    medusa_id: string
    medusa_title: string
    medusa_sku: string | null
    similarity: number
    match_type: "exact_sku" | "exact_name" | "similar" | "barcode"
}

export interface LinkedProduct {
    map_id: string
    contifico_id: string
    contifico_nombre: string
    contifico_codigo: string
    contifico_imagen?: string | null
    medusa_id: string
    medusa_title: string
    medusa_sku: string | null
    medusa_missing: boolean
    created_by_plugin: boolean
    auto_linked: boolean
    match_type: string | null
    link_origin: ProductLinkOrigin
    mapping_mode: VariantMode
    mapping_mode_override: VariantMode | null
    weighted_pvp_field: WeightedPvpField
    weighted_pvp_field_override: WeightedPvpField | null
    weighted_price_sync_enabled: boolean
    weighted_price_sync_override: boolean | null
    weighted_missing_variants: string[]
    weighted_variant_weights: Array<{
        label: string
        grams: number | null
    }>
    weighted_ready: boolean
    weighted_variants_total: number
    weighted_variants_ready: number
    effective_rules?: EffectiveProductRules | null
    diagnostics?: {
        weighted_ready: boolean
        missing_variants: string[]
        price_source: string
        link_origin: ProductLinkOrigin
    }
}

export interface UnmatchedProduct {
    contifico_id: string
    contifico_nombre: string
    contifico_codigo: string
    contifico_imagen?: string | null
}

export interface RelinkCandidate {
    contifico_id: string
    contifico_nombre: string
    contifico_codigo: string
    current_medusa_id: string
    current_medusa_title: string
    suggested_medusa_id: string | null
    suggested_medusa_title: string | null
    suggested_medusa_sku: string | null
    similarity: number
}

export interface AvailableMedusa {
    medusa_id: string
    medusa_title: string
    medusa_sku: string | null
}

export interface LinkStats {
    total_linked: number
    medusa_total: number
}

export const mappingModeLabel: Record<VariantMode, string> = {
    auto: "Automático",
    contifico: "Variantes Contífico",
    simple: "Variante única",
    weighted: "Por peso",
}

export const weightedPvpOptions: WeightedPvpField[] = [...WEIGHTED_PVP_FIELD_VALUES]
const EMPTY_SELECT_VALUE = "__empty__"

export interface MatchStats {
    contifico_total: number
    medusa_total: number
    already_linked: number
    exact_sku: number
    exact_name: number
    barcode: number
    similar: number
    unmatched_contifico: number
    relink_candidates: number
}

export const matchTypeLabel: Record<string, string> = {
    exact_sku: "SKU exacto",
    exact_name: "Nombre exacto",
    barcode: "Cod. barras",
    similar: "Similar",
    sku: "SKU",
    name: "Nombre",
}

export const matchTypeColor: Record<string, "green" | "blue" | "purple" | "orange"> = {
    exact_sku: "green",
    exact_name: "blue",
    barcode: "purple",
    similar: "orange",
    sku: "green",
    name: "blue",
}

export function SimilarityBadge({ score }: { score: number }) {
    if (score >= 0.9) return <Badge color="green">{(score * 100).toFixed(0)}%</Badge>
    if (score >= 0.7) return <Badge color="blue">{(score * 100).toFixed(0)}%</Badge>
    if (score >= 0.5) return <Badge color="orange">{(score * 100).toFixed(0)}%</Badge>
    return <Badge color="red">{(score * 100).toFixed(0)}%</Badge>
}

export function ContificoCell({
    nombre,
    codigo,
    currentMedusaTitle,
}: {
    nombre: string
    codigo: string
    currentMedusaTitle?: string
}) {
    return (
        <div>
            <Text weight="plus" className="text-sm">{nombre}</Text>
            <Text className="text-xs text-ui-fg-subtle">Cod: {codigo}</Text>
            {currentMedusaTitle && (
                <Text className="text-xs text-ui-fg-destructive">Actual: {currentMedusaTitle}</Text>
            )}
        </div>
    )
}

export function MedusaSelect({
    value,
    onChange,
    options,
    placeholder = "Seleccionar",
    suggestedId,
    suggestedTitle,
}: {
    value: string
    onChange: (value: string) => void
    options: AvailableMedusa[]
    placeholder?: string
    suggestedId?: string | null
    suggestedTitle?: string | null
}) {
    return (
        <>
            <Select
                value={value || EMPTY_SELECT_VALUE}
                onValueChange={(nextValue) =>
                    onChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)
                }
            >
                <Select.Trigger className="w-full">
                    <Select.Value placeholder={placeholder} />
                </Select.Trigger>
                <Select.Content>
                    <Select.Item value={EMPTY_SELECT_VALUE}>{placeholder}</Select.Item>
                    {options.map((option) => (
                        <Select.Item key={option.medusa_id} value={option.medusa_id}>
                            {option.medusa_title}
                            {option.medusa_sku ? ` (${option.medusa_sku})` : ""}
                            {option.medusa_id === suggestedId ? " ★" : ""}
                        </Select.Item>
                    ))}
                </Select.Content>
            </Select>
            {suggestedTitle && (
                <Text className="text-xs text-ui-fg-positive mt-1">★ Sugerido: {suggestedTitle}</Text>
            )}
        </>
    )
}
