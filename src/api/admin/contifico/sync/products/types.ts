import type { MedusaRequest } from "@medusajs/framework/http"
import type {
    IFulfillmentModuleService,
    IInventoryService,
    IPricingModuleService,
    IProductModuleService,
    ISalesChannelModuleService,
    IStockLocationService,
    IStoreModuleService,
} from "@medusajs/framework/types"
import type { ContificoBodega, ContificoProducto, ContificoVariante } from "../../../../../lib/types"
import type ContificoModuleService from "../../../../../modules/contifico/service"
import type { NormalizedContificoConfig, VariantMode } from "../../../../../lib/contifico-config"
import type { NdjsonStream } from "../../../../../lib/ndjson"
import type { MedusaProductLike, MedusaVariantLike } from "../../../../../lib/medusa-product"
import type { ProductEntityMapMetadata } from "../../../../../lib/contifico-metadata"
import type { WeightedPvpField } from "../../../../../lib/contifico-config"
import type { MedusaMatchIndex } from "./medusa-match-index"

export interface ProductSyncError {
    producto: string
    error: string
}

export interface ProductStockWarning {
    producto: string
    codigo: string
    cantidad_stock: number
    suma_bodegas: number
    bodegas_detalle: Array<{
        nombre: string
        cantidad: number
    }>
    accion: string
}

export interface ProductSyncMetrics {
    totalCreated: number
    totalErrors: number
    totalStockUpdated: number
    totalAutoLinked: number
    totalImages: number
    totalVariants: number
    totalLinkedPriceUpdated?: number
    totalWeightedPriceUpdated: number
    totalWeightedDeferred: number
}

export interface ProductSyncResult {
    message: string
    stats: {
        processed: number
        changes_applied: number
        created: number
        auto_linked: number
        stock_updated: number
        variants_created: number
        images_set: number
        linked_price_updated?: number
        weighted_price_updated: number
        weighted_pending_review: number
        errors: number
        duration_ms: number
    }
    errors: ProductSyncError[]
    weighted_warnings?: WeightedProductWarning[]
    stock_warnings: ProductStockWarning[]
}

export interface InventoryItemSummary {
    id: string
    sku: string
}

export interface InventoryItemRecord {
    id: string
    sku?: string | null
}

export interface InventoryLevelRecord {
    id: string
    inventory_item_id: string
}

export interface ContificoEntityMapRecord {
    id: string
    medusa_id: string
    contifico_id: string
    metadata?: ProductEntityMapMetadata | null
}

export interface QueryGraphService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

export interface LinkService {
    create(payload: unknown): Promise<unknown>
}

export interface StockLocationRecord {
    id: string
    name: string
    metadata?: Record<string, unknown> | null
}

export interface SalesChannelRecord {
    id: string
}

export interface ShippingProfileRecord {
    id: string
}

export interface StoreRecord {
    default_sales_channel_id?: string | null
}

export interface ProductVariantRecord {
    id: string
    sku?: string | null
    barcode?: string | null
    title?: string | null
    weight?: number | null
    metadata?: Record<string, unknown> | null
}

export interface MedusaProductRecord extends MedusaProductLike {
    variants?: ProductVariantRecord[] | null
    metadata?: Record<string, unknown> | null
}

export interface CreatedMedusaProduct extends MedusaProductRecord {
    variants?: Array<ProductVariantRecord & MedusaVariantLike> | null
}

export interface ProductSyncServices {
    contificoService: ContificoModuleService
    productService: IProductModuleService
    query: QueryGraphService
    inventoryService: IInventoryService
    stockLocationService: IStockLocationService
    fulfillmentModule: IFulfillmentModuleService
    salesChannelModule: ISalesChannelModuleService
    storeModule: IStoreModuleService
    pricingService: IPricingModuleService
    link: LinkService
}

export interface ProductSyncContext {
    req?: Pick<MedusaRequest, "protocol" | "get"> | null
    stream: NdjsonStream<ProductSyncResult>
    services: ProductSyncServices
    config: NormalizedContificoConfig
    clientApiKey: string
    request_base_url?: string | null
    bodegaIds: string[]
    shouldManageInventory: boolean
    shouldAllowBackorder: boolean
    variantMode: VariantMode
    shippingProfileId: string | null
    salesChannelId: string | null
    contificoBodegas: ContificoBodega[]
    bodegaMap: Map<string, ContificoBodega>
    bodegaToLocation: Map<string, string>
    primaryLocationId: string | null
}

export interface ProductCatalogData {
    contificoProducts: ContificoProducto[]
    activeProducts: ContificoProducto[]
    varianteMap: Map<string, ContificoVariante>
}

export interface MedusaCatalogData {
    existingMaps: ContificoEntityMapRecord[]
    mapByContifico: Map<string, ContificoEntityMapRecord>
    mapByMedusa: Map<string, ContificoEntityMapRecord>
    medusaProducts: MedusaProductRecord[]
    medusaById: Map<string, MedusaProductRecord>
    medusaBySku: Map<string, MedusaProductRecord>
    matchIndex: MedusaMatchIndex
    inventoryItemsBySku: Map<string, InventoryItemSummary>
    existingLevels: Map<string, string>
}

export interface LinkedProductRef {
    cp: ContificoProducto
    medusaId: string
    mappingMetadata: ProductEntityMapMetadata | null
    catalogFingerprint?: string | null
}

export interface ProductClassificationResult {
    linkedProducts: LinkedProductRef[]
    toCreate: ContificoProducto[]
}

export interface WeightedProductWarning {
    contifico_id: string
    contifico_nombre: string
    medusa_id: string
    medusa_title: string
    message: string
    missing_variants?: string[]
    weighted_pvp_field?: WeightedPvpField
}
