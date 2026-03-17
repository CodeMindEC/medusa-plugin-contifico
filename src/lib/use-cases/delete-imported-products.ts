import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    ContainerRegistrationKeys,
    Modules,
} from "@medusajs/framework/utils"
import type {
    IInventoryService,
    IPricingModuleService,
    IProductModuleService,
} from "@medusajs/framework/types"
import { buildProductMapMetadata } from "../contifico-metadata"
import {
    asProductMapMetadata,
    resolveProductLinkOrigin,
    type ProductEntityMapMetadata,
} from "../contifico-metadata"
import { restoreProductPriceSnapshot } from "../product-price-snapshot"
import {
    deleteInventoryItemsAfterProductCleanup,
    deleteInventoryLevelsForItems,
    loadInventoryItemIdsForProducts,
    type ProductInventoryQueryGraphService,
} from "../product-inventory-cleanup"
import { normalizeProductSyncState } from "../product-sync-state"
import { resolveLinkedProductCleanup } from "../strategies/delete-policy"
import {
    CONTIFICO_PRODUCTS_CLEANUP_REQUESTED,
    type ContificoSyncRequestedEvent,
} from "../contifico-sync-events"
import {
    completeSyncRun,
    ensureQueuedSyncRun,
    failSyncRun,
    markSyncRunRunning,
    readLogCorrelationId,
    type ContificoSyncLogRecord,
} from "../contifico-sync-runs"
import { getContificoConfig, getContificoService } from "../../api/admin/contifico/shared"
import type { DeletePolicyAdvancedSettings } from "../advanced-settings-contracts"
import { createCorrelationId, logContificoEvent } from "../observability"
import { createSyncLogProgressStream } from "../sync-log-progress-stream"

interface DeleteProductsResult {
    message?: string
    deleted?: number
    errors?: number
    duration_ms?: number
    error_details?: Array<{ producto: string; error: string }>
    error?: string
}

interface DeleteProductEntry {
    product_id: string
    map_id: string
}

interface EventBusService {
    emit(input: { name: string; data: Record<string, unknown> }): Promise<void>
}

export interface ProductCleanupPlan {
    map_id: string
    medusa_id: string
    metadata: ProductEntityMapMetadata
    action: "delete_product" | "unlink_only"
    restore_prices: boolean
}

interface UnlinkExistingProductsResult {
    unlinked: number
    restored_prices: number
    missing_snapshot: number
    errors: Array<{ producto: string; error: string }>
    deletedMapIds: string[]
    failedEntries: Array<{ map_id: string; error: string }>
}

interface DeleteProductsAndCollectMapIdsResult {
    deleted: number
    deletedProductIds: string[]
    errors: Array<{ producto: string; error: string }>
    deletedMapIds: string[]
    failedEntries: Array<{ map_id: string; error: string }>
}

interface CleanupQueueSummary {
    marked_pending: number
    already_pending: number
}

const UNLINK_BATCH_SIZE = 10
const MAP_UPDATE_BATCH_SIZE = 25

export async function runDeleteImportedProducts(
    req: MedusaRequest,
    res: MedusaResponse
) {
    const contificoService = getContificoService(req.scope)
    const { normalized: config } = await getContificoConfig(contificoService)

    if (!config) {
        res.status(400).json({ error: "No hay configuración de Contífico." })
        return
    }

    const activeRun = await ensureQueuedSyncRun({
        service: contificoService,
        sync_type: "products-delete",
        config_id: config.id,
        requested_by: "manual",
        initial_details: {
            request_base_url: `${req.protocol}://${req.get("host")}`,
        },
    })

    if (!activeRun.created) {
        res.json({
            log_id: activeRun.id,
            sync_type: "products-delete",
            status: activeRun.status,
        })
        return
    }

    const pendingSummary = await markProductMapsPendingCleanup(
        contificoService,
        config.advanced_settings.delete_policy
    )

    await contificoService.updateContificoSyncLogs({
        id: activeRun.id,
        details: {
            ...(activeRun.details || {}),
            request_base_url: `${req.protocol}://${req.get("host")}`,
            cleanup_pending: pendingSummary.marked_pending,
            cleanup_already_pending: pendingSummary.already_pending,
        },
    })

    const eventBus = req.scope.resolve(Modules.EVENT_BUS) as EventBusService
    if (activeRun.created) {
        await eventBus.emit({
            name: CONTIFICO_PRODUCTS_CLEANUP_REQUESTED,
            data: {
                log_id: activeRun.id,
                config_id: config.id,
                request_base_url: `${req.protocol}://${req.get("host")}`,
            } satisfies ContificoSyncRequestedEvent,
        })
    }

    res.json({
        log_id: activeRun.id,
        sync_type: "products-delete",
        status: "queued",
    })
}

export async function processQueuedDeleteImportedProductsJob(
    scope: { resolve: (key: string) => unknown },
    { log_id, request_base_url }: ContificoSyncRequestedEvent
) {
    const started = Date.now()
    const correlationId = createCorrelationId("contifico_delete_products")
    const service = getContificoService(scope)
    const log = await ensureExistingCleanupLog(service, log_id)
    if (!log) {
        return
    }

    await markSyncRunRunning(service, log.id, {
        correlation_id: readLogCorrelationId(log.details) || correlationId,
        request_base_url: request_base_url || null,
    })

    const streamState: { error?: string } = {}
    const stream = createSyncLogProgressStream<DeleteProductsResult>(
        service,
        log,
        streamState
    )

    try {
        const { normalized: config } = await getContificoConfig(service)
        if (!config) {
            throw new Error("No hay configuración de Contífico.")
        }

        stream.progress("init", "Buscando productos marcados para limpieza...", 5)
        const productService = scope.resolve(Modules.PRODUCT) as IProductModuleService
        const inventoryService = scope.resolve(Modules.INVENTORY) as IInventoryService
        const pricingService = scope.resolve(Modules.PRICING) as IPricingModuleService
        const query = scope.resolve(
            ContainerRegistrationKeys.QUERY
        ) as ProductInventoryQueryGraphService

        const cleanupPlans = await loadPendingCleanupPlans(
            service,
            config.advanced_settings.delete_policy
        )

        if (cleanupPlans.length === 0) {
            await completeSyncRun({
                service,
                log_id: log.id,
                status: "success",
                total_processed: 0,
                total_errors: 0,
                details: {
                    correlation_id: correlationId,
                    cleanup_pending: 0,
                },
            })
            return
        }

        const toDelete = cleanupPlans.filter((item) => item.action === "delete_product")
        const toUnlink = cleanupPlans.filter((item) => item.action === "unlink_only")
        const total = cleanupPlans.length
        const productIds = toDelete.map((m) => m.medusa_id)

        stream.progress("loading", `Cargando datos de ${total} productos...`, 10)

        const {
            allInventoryItemIds,
            inventoryItemIdsByProductId,
        } = await loadInventoryItemIdsForProducts({
            productService,
            query,
            productIds,
        })

        stream.progress(
            "loading",
            `${allInventoryItemIds.length} items de inventario. Buscando niveles...`,
            20
        )

        stream.progress(
            "inventory",
            `${allInventoryItemIds.length} items de inventario. Limpiando...`,
            35
        )

        await deleteInventoryLevelsForItems(inventoryService, allInventoryItemIds)

        stream.progress("products", `Procesando ${total} vínculo(s)...`, 60)

        const deleteResult = await deleteProductsAndCollectMapIds(
            productService,
            toDelete.map((item) => ({
                product_id: item.medusa_id,
                map_id: item.map_id,
            })),
            stream
        )

        stream.progress("inventory", "Eliminando inventario órfano de productos borrados...", 82)
        const deletedInventoryItemIds = Array.from(
            new Set(
                deleteResult.deletedProductIds.flatMap((productId) =>
                    inventoryItemIdsByProductId.get(productId) || []
                )
            )
        )
        const inventoryCleanupErrors = await deleteInventoryItemsAfterProductCleanup(
            inventoryService,
            deletedInventoryItemIds
        )

        stream.progress("restore", "Restaurando precios y quitando sincronización...", 84)
        const unlinkResult = await unlinkExistingProducts(
            pricingService,
            toUnlink,
            stream
        )

        stream.progress("cleanup", "Limpiando registros de mapeo...", 90)
        const mapIdsToDelete = [...deleteResult.deletedMapIds, ...unlinkResult.deletedMapIds]
        if (mapIdsToDelete.length > 0) {
            try {
                await service.deleteContificoEntityMaps(mapIdsToDelete)
            } catch {
                for (const id of mapIdsToDelete) {
                    try {
                        await service.deleteContificoEntityMaps(id)
                    } catch {
                        // Ignore; failed maps will remain pending/failed for retry.
                    }
                }
            }
        }

        const failedEntries = [...deleteResult.failedEntries, ...unlinkResult.failedEntries]
        if (failedEntries.length > 0) {
            await markFailedCleanupEntries(service, cleanupPlans, failedEntries)
        }

        const totalErrors =
            deleteResult.errors.length +
            unlinkResult.errors.length +
            inventoryCleanupErrors.length
        const deletedTotal = deleteResult.deleted + unlinkResult.unlinked

        await completeSyncRun({
            service,
            log_id: log.id,
            status: totalErrors > 0 ? "partial" : "success",
            total_processed: deletedTotal,
            total_errors: totalErrors,
            details: {
                correlation_id: correlationId,
                requested: total,
                cleanup_pending: cleanupPlans.length,
                cleanup_deleted: deleteResult.deleted,
                cleanup_unlinked: unlinkResult.unlinked,
                cleanup_restored_prices: unlinkResult.restored_prices,
                cleanup_deleted_inventory_items:
                    deletedInventoryItemIds.length - inventoryCleanupErrors.length,
                restored_missing_snapshot: unlinkResult.missing_snapshot,
                deleted_maps: mapIdsToDelete.length,
                skipped_maps: total - mapIdsToDelete.length,
                error_details: [
                    ...deleteResult.errors,
                    ...unlinkResult.errors,
                    ...inventoryCleanupErrors,
                ].slice(0, 20),
            },
        })

        logContificoEvent(
            totalErrors > 0 ? "warn" : "info",
            "Product desync cleanup completed",
            {
                correlation_id: correlationId,
                operation: "products_delete.queue_run",
                deleted: deleteResult.deleted,
                unlinked: unlinkResult.unlinked,
                restored_prices: unlinkResult.restored_prices,
                deleted_inventory_items:
                    deletedInventoryItemIds.length - inventoryCleanupErrors.length,
                errors: totalErrors,
                duration_ms: Date.now() - started,
            }
        )
    } catch (error) {
        await failSyncRun(
            service,
            log.id,
            error instanceof Error ? error.message : "Error eliminando",
            {
                correlation_id: correlationId,
                operation: "products_delete.queue_run",
            }
        )

        logContificoEvent(
            "error",
            "Delete imported products failed",
            {
                correlation_id: correlationId,
                operation: "products_delete.queue_run",
                duration_ms: Date.now() - started,
            },
            error
        )
    }
}

async function markProductMapsPendingCleanup(
    service: ReturnType<typeof getContificoService>,
    deletePolicy: DeletePolicyAdvancedSettings
): Promise<CleanupQueueSummary> {
    const [maps] = await service.listAndCountContificoEntityMaps(
        { entity_type: "product" },
        { take: 5000 }
    )

    const requestedAt = new Date().toISOString()
    const updates = maps
        .map((map) => {
            const metadata = asProductMapMetadata(map.metadata)
            if (metadata.sync_state?.cleanup_state === "pending") {
                return null
            }

            const linkOrigin = resolveProductLinkOrigin(metadata)
            const cleanupPlan = resolveLinkedProductCleanup(
                linkOrigin,
                deletePolicy,
                metadata.sync_snapshot
            )
            return {
                id: map.id,
                metadata: buildProductMapMetadata({
                    ...metadata,
                    sync_state: {
                        ...normalizeProductSyncState(metadata.sync_state),
                        cleanup_state: "pending",
                        cleanup_requested_at: requestedAt,
                        cleanup_last_error: null,
                    },
                }),
                action: cleanupPlan.action,
            }
        })
        .filter(
            (
                item
            ): item is {
                id: string
                metadata: ReturnType<typeof buildProductMapMetadata>
                action: "delete_product" | "unlink_only"
            } => !!item
        )

    for (let index = 0; index < updates.length; index += MAP_UPDATE_BATCH_SIZE) {
        const batch = updates.slice(index, index + MAP_UPDATE_BATCH_SIZE)
        await Promise.all(
            batch.map((item) =>
                service.updateContificoEntityMaps({
                    id: item.id,
                    metadata: item.metadata,
                })
            )
        )
    }

    return {
        marked_pending: updates.length,
        already_pending: maps.length - updates.length,
    }
}

async function loadPendingCleanupPlans(
    service: ReturnType<typeof getContificoService>,
    deletePolicy: DeletePolicyAdvancedSettings
) {
    const [maps] = await service.listAndCountContificoEntityMaps(
        { entity_type: "product" },
        { take: 5000 }
    )

    return maps
        .map((map) => ({
            map_id: map.id,
            medusa_id: map.medusa_id,
            metadata: asProductMapMetadata(map.metadata),
        }))
        .filter((map) => {
            const state = normalizeProductSyncState(map.metadata.sync_state)
            return state?.cleanup_state === "pending" || state?.cleanup_state === "failed"
        })
        .map((map) => {
            const linkOrigin = resolveProductLinkOrigin(map.metadata)
            const cleanup = resolveLinkedProductCleanup(
                linkOrigin,
                deletePolicy,
                map.metadata.sync_snapshot
            )
            return {
                ...map,
                action: cleanup.action,
                restore_prices: cleanup.restore_prices,
            } satisfies ProductCleanupPlan
        })
}

async function markFailedCleanupEntries(
    service: ReturnType<typeof getContificoService>,
    cleanupPlans: ProductCleanupPlan[],
    failedEntries: Array<{ map_id: string; error: string }>
) {
    const planById = new Map(cleanupPlans.map((plan) => [plan.map_id, plan]))
    const updates = failedEntries
        .map((entry) => {
            const plan = planById.get(entry.map_id)
            if (!plan) {
                return null
            }

            return {
                id: entry.map_id,
                metadata: buildProductMapMetadata({
                    ...plan.metadata,
                    sync_state: {
                        ...normalizeProductSyncState(plan.metadata.sync_state),
                        cleanup_state: "failed",
                        cleanup_last_error: entry.error,
                    },
                }),
            }
        })
        .filter((item): item is { id: string; metadata: ReturnType<typeof buildProductMapMetadata> } => !!item)

    for (let index = 0; index < updates.length; index += MAP_UPDATE_BATCH_SIZE) {
        const batch = updates.slice(index, index + MAP_UPDATE_BATCH_SIZE)
        await Promise.all(
            batch.map((item) =>
                service.updateContificoEntityMaps({
                    id: item.id,
                    metadata: item.metadata,
                })
            )
        )
    }
}

async function ensureExistingCleanupLog(
    service: ReturnType<typeof getContificoService>,
    log_id: string
) {
    const [logs] = await service.listAndCountContificoSyncLogs({ id: log_id }, { take: 1 })
    const log = logs[0] as ContificoSyncLogRecord | undefined
    if (!log || log.status !== "queued") {
        return null
    }

    return log
}

export async function unlinkExistingProducts(
    pricingService: Pick<IPricingModuleService, "updatePriceSets">,
    entries: ProductCleanupPlan[],
    stream?: ReturnType<typeof createSyncLogProgressStream<DeleteProductsResult>>
): Promise<UnlinkExistingProductsResult> {
    let unlinked = 0
    let restoredPrices = 0
    let missingSnapshot = 0
    const errors: Array<{ producto: string; error: string }> = []
    const deletedMapIds: string[] = []
    const failedEntries: Array<{ map_id: string; error: string }> = []

    for (let index = 0; index < entries.length; index += UNLINK_BATCH_SIZE) {
        const batch = entries.slice(index, index + UNLINK_BATCH_SIZE)
        if (stream) {
            const pct =
                84 +
                Math.round(
                    4 *
                        (Math.min(index + batch.length, entries.length) /
                            Math.max(entries.length, 1))
                )
            stream.progress(
                "restore",
                `Desvinculando ${index + 1}-${Math.min(
                    index + batch.length,
                    entries.length
                )}/${entries.length}...`,
                pct
            )
        }

        const results = await Promise.all(
            batch.map(async (entry) => {
                try {
                    if (entry.restore_prices) {
                        const result = await restoreProductPriceSnapshot({
                            pricingService,
                            snapshot: entry.metadata.sync_snapshot,
                        })

                        return {
                            entry,
                            restored: result.restored,
                            missingSnapshot: 0,
                            errors: result.errors.map((error) => ({
                                producto: entry.medusa_id,
                                error: `Restaurar precios (${error.variant_id}): ${error.error}`,
                            })),
                        }
                    }

                    return {
                        entry,
                        restored: 0,
                        missingSnapshot: 1,
                        errors: [] as Array<{ producto: string; error: string }>,
                    }
                } catch (error) {
                    return {
                        entry,
                        restored: 0,
                        missingSnapshot: 0,
                        errors: [
                            {
                                producto: entry.medusa_id,
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : "Error desvinculando",
                            },
                        ],
                    }
                }
            })
        )

        for (const result of results) {
            restoredPrices += result.restored
            missingSnapshot += result.missingSnapshot
            if (result.errors.length > 0) {
                errors.push(...result.errors)
                failedEntries.push({
                    map_id: result.entry.map_id,
                    error: result.errors.map((error) => error.error).join("; "),
                })
                continue
            }

            deletedMapIds.push(result.entry.map_id)
            unlinked++
        }
    }

    return {
        unlinked,
        restored_prices: restoredPrices,
        missing_snapshot: missingSnapshot,
        errors,
        deletedMapIds,
        failedEntries,
    }
}

export async function deleteProductsAndCollectMapIds(
    productService: Pick<IProductModuleService, "deleteProducts">,
    entries: DeleteProductEntry[],
    stream?: ReturnType<typeof createSyncLogProgressStream<DeleteProductsResult>>
): Promise<DeleteProductsAndCollectMapIdsResult> {
    let deleted = 0
    const deletedProductIds: string[] = []
    const errors: Array<{ producto: string; error: string }> = []
    const deletedMapIds: string[] = []
    const failedEntries: Array<{ map_id: string; error: string }> = []

    const productChunks = chunkArray(entries, 50)
    for (let chunkIndex = 0; chunkIndex < productChunks.length; chunkIndex++) {
        const chunk = productChunks[chunkIndex]
        if (stream) {
            const from = chunkIndex * 50 + 1
            const to = Math.min(from + chunk.length - 1, entries.length)
            const pct = 60 + Math.round(25 * (from / Math.max(entries.length, 1)))
            stream.progress("products", `Eliminando ${from}-${to}/${entries.length}...`, pct)
        }

        try {
            await productService.deleteProducts(chunk.map((entry) => entry.product_id))
            deleted += chunk.length
            deletedProductIds.push(...chunk.map((entry) => entry.product_id))
            deletedMapIds.push(...chunk.map((entry) => entry.map_id))
        } catch {
            for (const entry of chunk) {
                try {
                    await productService.deleteProducts([entry.product_id])
                    deleted++
                    deletedProductIds.push(entry.product_id)
                    deletedMapIds.push(entry.map_id)
                } catch (err) {
                    const error = err instanceof Error ? err.message : "Error eliminando producto"
                    errors.push({
                        producto: entry.product_id,
                        error,
                    })
                    failedEntries.push({
                        map_id: entry.map_id,
                        error,
                    })
                }
            }
        }
    }

    return {
        deleted,
        deletedProductIds,
        errors,
        deletedMapIds,
        failedEntries,
    }
}

export { deleteInventoryItemsAfterProductCleanup }

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize))
    }
    return chunks
}
