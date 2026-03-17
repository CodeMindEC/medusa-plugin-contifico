import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import {
    CONTIFICO_PRODUCTS_STOCK_REQUESTED,
    type ContificoSyncRequestedEvent,
} from "../lib/contifico-sync-events"
import { processQueuedProductStockSyncJob } from "../lib/use-cases/product-sync"

export default async function contificoProductsStockHandler({
    event: { data },
    container,
}: SubscriberArgs<ContificoSyncRequestedEvent>) {
    await processQueuedProductStockSyncJob(container, data)
}

export const config: SubscriberConfig = {
    event: CONTIFICO_PRODUCTS_STOCK_REQUESTED,
}
