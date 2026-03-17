import {
    normalizeProductRulesOverride,
    type ProductRulesOverride,
} from "./advanced-settings"
import { normalizeProductSyncSnapshot, type ProductSyncSnapshot } from "./product-sync-snapshot"
import {
    normalizeProductSyncState,
    type ProductSyncState,
} from "./product-sync-state"

export type {
    ProductSyncSnapshot,
    ProductVariantPriceSnapshot,
    ProductVariantPriceSnapshotPrice,
} from "./product-sync-snapshot"

export type ProductMatchType =
    | "exact_sku"
    | "exact_name"
    | "similar"
    | "barcode"
    | "sku"
    | "name"

export type ProductMappingModeOverride = "auto" | "contifico" | "simple" | "weighted"
export type WeightedPvpField = "pvp1" | "pvp2" | "pvp3" | "pvp4"
export type ProductLinkOrigin = "plugin_created" | "manual" | "relinked_to_existing"

export interface ProductEntityMapMetadata extends Record<string, unknown> {
    schema_version?: 2
    codigo?: string
    nombre?: string
    imagen?: string | null
    created?: boolean
    auto_linked?: boolean
    match_type?: ProductMatchType
    similarity?: number
    re_linked?: boolean
    re_linked_from?: string
    mapping_mode_override?: ProductMappingModeOverride | null
    weighted_pvp_field?: WeightedPvpField | null
    contifico_stock_grams?: number | null
    link_origin?: ProductLinkOrigin | null
    product_rules_override?: ProductRulesOverride | null
    sync_snapshot?: ProductSyncSnapshot | null
    sync_state?: ProductSyncState | null
    weighted_creation_profile_id?: string | null
}

export interface CustomerEntityMapMetadata extends Record<string, unknown> {
    contifico_id?: string
    cedula?: string | null
    ruc?: string | null
    tipo?: "N" | "J" | "I" | "P"
    tipo_persona?: string | null
    es_proveedor?: boolean
    nombre_comercial?: string | null
    pvp_default?: string | null
    dias_credito?: number | string | null
    cupo_credito?: number | string | null
    auto_linked?: boolean
}

export interface InvoiceEntityMapMetadata extends Record<string, unknown> {
    referencia?: string | null
    tipo_documento?: "PRE" | "FAC" | null
    estado?: string | null
    total?: string | number | null
    order_id?: string
    test?: boolean
    documento?: string | null
    url_ride?: string | null
    url_xml?: string | null
    created_at?: string | null
    client_name?: string | null
    client_identification?: string | null
    correlation_id?: string | null
    auto?: boolean
}

export function asProductMapMetadata(
    metadata: unknown
): ProductEntityMapMetadata {
    return normalizeProductMapMetadata(isRecord(metadata) ? metadata : {})
}

export function asCustomerMapMetadata(
    metadata: unknown
): CustomerEntityMapMetadata {
    return isRecord(metadata) ? metadata : {}
}

export function asInvoiceMapMetadata(
    metadata: unknown
): InvoiceEntityMapMetadata {
    return isRecord(metadata) ? metadata : {}
}

export function buildProductMapMetadata(
    metadata: ProductEntityMapMetadata
): ProductEntityMapMetadata | null {
    const normalized = normalizeProductMapMetadata(metadata)
    return hasMetadataValues(normalized) ? normalized : null
}

export function buildInvoiceMapMetadata(
    metadata: InvoiceEntityMapMetadata
): InvoiceEntityMapMetadata | null {
    return hasMetadataValues(metadata) ? metadata : null
}

export function resolveProductLinkOrigin(
    metadata: ProductEntityMapMetadata | null | undefined
): ProductLinkOrigin {
    if (metadata?.link_origin) {
        return metadata.link_origin
    }

    if (metadata?.re_linked) {
        return "relinked_to_existing"
    }

    return metadata?.created === true ? "plugin_created" : "manual"
}

export function needsProductMapMetadataMigration(metadata: unknown): boolean {
    if (!isRecord(metadata)) {
        return false
    }

    return JSON.stringify(metadata) !== JSON.stringify(normalizeProductMapMetadata(metadata))
}

function normalizeProductMapMetadata(
    metadata: Record<string, unknown>
): ProductEntityMapMetadata {
    const normalizedRules = normalizeProductRulesOverride(
        metadata.product_rules_override as ProductRulesOverride | null | undefined
    )
    const normalizedSnapshot = normalizeProductSyncSnapshot(metadata.sync_snapshot)
    const normalizedSyncState = normalizeProductSyncState(metadata.sync_state)

    const next: ProductEntityMapMetadata = {
        ...metadata,
        schema_version: 2,
        link_origin: resolveProductLinkOrigin(metadata as ProductEntityMapMetadata),
        product_rules_override: normalizedRules || undefined,
        sync_snapshot: normalizedSnapshot,
        sync_state: normalizedSyncState,
    }

    return cleanupMetadata(next)
}

function cleanupMetadata(metadata: ProductEntityMapMetadata): ProductEntityMapMetadata {
    const next = Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined)
    ) as ProductEntityMapMetadata

    return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function hasMetadataValues(metadata: Record<string, unknown>): boolean {
    return Object.keys(metadata).length > 0
}
