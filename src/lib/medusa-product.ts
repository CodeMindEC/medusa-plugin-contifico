export interface MedusaVariantLike {
    id?: string
    sku?: string | null
    barcode?: string | null
}

export interface MedusaProductLike {
    id: string
    title: string
    handle?: string | null
    variants?: MedusaVariantLike[] | null
}

export function getPrimaryVariantSku(product: MedusaProductLike): string | null {
    return product.variants?.[0]?.sku || null
}

export function getVariantSkus(product: MedusaProductLike): string[] {
    return (product.variants || [])
        .map((variant) => variant.sku)
        .filter((sku): sku is string => !!sku)
}

export function getVariantBarcodes(product: MedusaProductLike): string[] {
    return (product.variants || [])
        .map((variant) => variant.barcode)
        .filter((barcode): barcode is string => !!barcode)
}
