import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import {
    CONTIFICO_PRODUCTS_SYNC_REQUESTED,
    type ContificoSyncRequestedEvent,
} from "../lib/contifico-sync-events"
import { processQueuedProductSyncJob } from "../lib/use-cases/product-sync"

export default async function contificoProductsSyncHandler({
    event: { data },
    container,
}: SubscriberArgs<ContificoSyncRequestedEvent>) {
    await processQueuedProductSyncJob(container, data)
}

export const config: SubscriberConfig = {
    event: CONTIFICO_PRODUCTS_SYNC_REQUESTED,
}
