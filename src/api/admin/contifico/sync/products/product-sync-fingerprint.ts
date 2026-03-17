import type { AdvancedContificoSettings } from "../../../../../lib/advanced-settings"
import type { ProductEntityMapMetadata } from "../../../../../lib/contifico-metadata"
import type { ContificoProducto } from "../../../../../lib/types"

export function buildCatalogFingerprint(product: ContificoProducto): string {
    return JSON.stringify({
        id: product.id,
        codigo: product.codigo,
        nombre: product.nombre,
        descripcion: product.descripcion || null,
        imagen: product.imagen || null,
        estado: product.estado,
        porcentaje_iva: product.porcentaje_iva ?? null,
        codigo_barra: product.codigo_barra || null,
        categoria_id: product.categoria_id || null,
        marca_id: product.marca_id || null,
        unidad: product.unidad || null,
        pvp1: product.pvp1 || null,
        pvp2: product.pvp2 || null,
        pvp3: product.pvp3 || null,
        pvp4: product.pvp4 || null,
        cantidad_stock: product.cantidad_stock ?? null,
        detalle_variantes: (product.detalle_variantes || []).map((item) => ({
            variante_id: item.variante_id,
            valor_id: item.valor_id || null,
        })),
    })
}

export function buildWeightedConfigFingerprint(
    settings: AdvancedContificoSettings["weighted"]
): string {
    return JSON.stringify({
        enabled: settings.enabled,
        allow_weighted_price_sync: settings.allow_weighted_price_sync,
        pricing_strategy: settings.pricing_strategy,
        strategy_config: settings.strategy_config,
        creation_mode: settings.creation_mode,
        default_profile_id: settings.default_profile_id,
        creation_profiles: settings.creation_profiles,
    })
}

export function hasCatalogFingerprintChanged(
    metadata: ProductEntityMapMetadata | null | undefined,
    nextFingerprint: string
) {
    return metadata?.sync_state?.catalog_fingerprint !== nextFingerprint
}

export function hasWeightedConfigFingerprintChanged(
    metadata: ProductEntityMapMetadata | null | undefined,
    nextFingerprint: string
) {
    return metadata?.sync_state?.weighted_config_fingerprint !== nextFingerprint
}
