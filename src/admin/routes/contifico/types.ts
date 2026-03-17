import type { ImportFilterConfig, ImportFilterRule } from "../../../lib/contifico-filters"
import type {
    AdvancedContificoSettings,
    PreviewResult,
} from "../../../lib/advanced-settings"
import type {
    VariantMode,
    WeightedPvpField,
} from "../../../lib/contifico-config"

export interface ContificoConfigData {
    id: string
    api_key: string
    api_pos: string | null
    bodega_ids: string[]
    sync_products_enabled: boolean
    sync_customers_enabled: boolean
    auto_invoice_enabled: boolean
    auto_preinvoice_enabled: boolean
    sync_interval_minutes: number
    manage_inventory: boolean
    allow_backorder: boolean
    sales_channel_id: string | null
    shipping_profile_id: string | null
    variant_mode: VariantMode
    weighted_pvp_field: WeightedPvpField
    advanced_settings: AdvancedContificoSettings
    invoice_test_mode: boolean
    last_product_sync: string | null
    last_customer_sync: string | null
    import_filters: ImportFilterConfig | null
}

export type ImportFilterRuleData = ImportFilterRule
export type ImportFiltersData = ImportFilterConfig

export interface InvoiceEntry {
    id: string
    medusa_order_id: string
    contifico_doc_id: string
    is_test: boolean
    referencia: string | null
    tipo_documento: string | null
    estado: string | null
    documento?: string | null
    total: string | null
    created_at: string
}

export interface Bodega {
    id: string
    nombre: string
}

export interface SyncLog {
    id: string
    sync_type: string
    status: string
    phase?: string | null
    progress_percent?: number | null
    finished_at?: string | null
    parent_log_id?: string | null
    total_processed: number
    total_errors: number
    details?: SyncLogDetails | null
    duration_ms: number
    started_at: string
    created_at: string
}

export interface SyncLogErrorEntry {
    error: string
    producto?: string
    persona?: string
    id?: string
    variant_id?: string
}

export interface SyncLogDetails {
    correlation_id?: string
    fatal?: string
    errors?: Array<string | SyncLogErrorEntry>
    error_details?: Array<string | SyncLogErrorEntry>
    [key: string]: unknown
}

export interface ProgressState {
    phase: string
    message: string
    percent: number
}

export interface StockWarning {
    producto: string
    codigo: string
    cantidad_stock: number
    suma_bodegas: number
}

export interface SyncActionResult {
    log_id?: string
    sync_type?: string
    status?: string
    message?: string
    error?: string
}

export interface ProductSyncActionResult extends SyncActionResult {
    stock_warnings?: StockWarning[]
}

export interface DeleteSyncActionResult extends SyncActionResult {
    deleted?: number
    errors?: number
    duration_ms?: number
}

export type PreviewActionResult = PreviewResult
