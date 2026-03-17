import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import {
    CONTIFICO_PRODUCTS_CLEANUP_REQUESTED,
    type ContificoSyncRequestedEvent,
} from "../lib/contifico-sync-events"
import { processQueuedDeleteImportedProductsJob } from "../lib/use-cases/delete-imported-products"

export default async function contificoProductsCleanupHandler({
    event: { data },
    container,
}: SubscriberArgs<ContificoSyncRequestedEvent>) {
    await processQueuedDeleteImportedProductsJob(container, data)
}

export const config: SubscriberConfig = {
    event: CONTIFICO_PRODUCTS_CLEANUP_REQUESTED,
}
