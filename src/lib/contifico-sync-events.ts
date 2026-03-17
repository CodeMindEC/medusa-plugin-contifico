export const CONTIFICO_PRODUCTS_SYNC_REQUESTED = "contifico.products.sync.requested"
export const CONTIFICO_PRODUCTS_STOCK_REQUESTED = "contifico.products.stock.requested"
export const CONTIFICO_PRODUCTS_CLEANUP_REQUESTED =
    "contifico.products.cleanup.requested"

export interface ContificoSyncRequestedEvent {
    log_id: string
    config_id?: string | null
    request_base_url?: string | null
}
