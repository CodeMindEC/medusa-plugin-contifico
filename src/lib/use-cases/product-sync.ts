import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { MedusaProductRecord } from "../../api/admin/contifico/sync/products/types"
import { classifyProducts } from "../../api/admin/contifico/sync/products/product-matcher"
import {
    loadContificoCatalog,
    loadMedusaCatalog,
    loadProductEntityMaps,
    loadProductSyncContextFromScope,
} from "../../api/admin/contifico/sync/products/product-sync-config"
import { createProductsFromContifico } from "../../api/admin/contifico/sync/products/product-create-payloads"
import { syncLinkedProductPrices } from "../../api/admin/contifico/sync/products/linked-price-sync"
import { syncLinkedProductStock } from "../../api/admin/contifico/sync/products/stock-sync"
import { syncWeightedLinkedProductPrices } from "../../api/admin/contifico/sync/products/weighted-sync"
import type {
    LinkedProductRef,
    MedusaCatalogData,
    ProductSyncError,
    ProductSyncMetrics,
} from "../../api/admin/contifico/sync/products/types"
import {
    CONTIFICO_PRODUCTS_STOCK_REQUESTED,
    CONTIFICO_PRODUCTS_SYNC_REQUESTED,
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
import { bindContificoLogger, createCorrelationId, logContificoEvent } from "../observability"
import { createSyncLogProgressStream } from "../sync-log-progress-stream"

interface EventBusService {
    emit(input: { name: string; data: Record<string, unknown> }): Promise<void>
}

interface SyncRunnerOptions {
    log_id: string
    request_base_url?: string | null
}

interface ProductSyncExecutionResult {
    message: string
    metrics: ProductSyncMetrics
    processed: number
    changes_applied: number
    linkedPriceWarnings: Awaited<ReturnType<typeof syncLinkedProductPrices>>
    weightedWarnings: Awaited<ReturnType<typeof syncWeightedLinkedProductPrices>>
}

interface ProductStockExecutionResult {
    message: string
    processed: number
    totalUpdated: number
    stockWarnings: Awaited<ReturnType<typeof syncLinkedProductStock>>["stockWarnings"]
    stockCandidates: number
    stockSkippedUnchanged: number
    stockDetailCalls: number
}

export async function runProductSync(req: MedusaRequest, res: MedusaResponse) {
    const service = getContificoService(req.scope)
    const { normalized: config } = await getContificoConfig(service)

    if (!config) {
        res.status(400).json({ error: "No hay configuración de Contífico." })
        return
    }

    const log = await ensureQueuedSyncRun({
        service,
        sync_type: "products",
        config_id: config.id,
        requested_by: "manual",
        initial_details: {
            request_base_url: `${req.protocol}://${req.get("host")}`,
        },
    })

    const eventBus = req.scope.resolve(Modules.EVENT_BUS) as EventBusService
    if (!log.created) {
        res.json({
            log_id: log.id,
            sync_type: "products",
            status: log.status,
        })
        return
    }

    if (log.created) {
        await eventBus.emit({
            name: CONTIFICO_PRODUCTS_SYNC_REQUESTED,
            data: {
                log_id: log.id,
                config_id: config.id,
                request_base_url: `${req.protocol}://${req.get("host")}`,
            } satisfies ContificoSyncRequestedEvent,
        })
    }

    res.json({
        log_id: log.id,
        sync_type: "products",
        status: log.status,
    })
}

export async function runProductStockSync(
    req: MedusaRequest,
    res: MedusaResponse
) {
    const service = getContificoService(req.scope)
    const { normalized: config } = await getContificoConfig(service)

    if (!config) {
        res.status(400).json({ error: "No hay configuración de Contífico." })
        return
    }

    const log = await ensureQueuedSyncRun({
        service,
        sync_type: "products-stock",
        config_id: config.id,
        requested_by: "manual",
    })

    const eventBus = req.scope.resolve(Modules.EVENT_BUS) as EventBusService
    if (!log.created) {
        res.json({
            log_id: log.id,
            sync_type: "products-stock",
            status: log.status,
        })
        return
    }

    if (log.created) {
        await eventBus.emit({
            name: CONTIFICO_PRODUCTS_STOCK_REQUESTED,
            data: {
                log_id: log.id,
                config_id: config.id,
                request_base_url: `${req.protocol}://${req.get("host")}`,
            } satisfies ContificoSyncRequestedEvent,
        })
    }

    res.json({
        log_id: log.id,
        sync_type: "products-stock",
        status: log.status,
    })
}

export async function processQueuedProductSyncJob(
    scope: { resolve: (key: string) => unknown },
    { log_id, request_base_url }: SyncRunnerOptions
) {
    bindContificoLogger(scope)
    const service = getContificoService(scope)
    const log = await ensureExistingQueuedLog(service, log_id)
    if (!log) {
        return
    }

    const correlationId =
        readLogCorrelationId(log.details) || createCorrelationId("contifico_product_sync")
    await markSyncRunRunning(service, log.id, {
        correlation_id: correlationId,
        request_base_url: request_base_url || null,
    })

    const streamState: { error?: string } = {}
    const stream = createSyncLogProgressStream(service, log, streamState)
    const context = await loadProductSyncContextFromScope({
        scope,
        stream,
        request_base_url: request_base_url || null,
    })

    if (!context) {
        await failSyncRun(service, log.id, streamState.error || "No se pudo inicializar el sync.", {
            correlation_id: correlationId,
            operation: "product_sync.queue_init",
        })
        return
    }

    const started = Date.now()
    const errors: ProductSyncError[] = []
    const metrics = createEmptyProductSyncMetrics()

    try {
        const execution = await executeCatalogSync(context, metrics, errors)
        const status = metrics.totalErrors > 0 ? "partial" : "success"
        await service.updateContificoConfigs({
            id: context.config.id,
            last_product_sync: new Date().toISOString(),
        })

        await completeSyncRun({
            service,
            log_id: log.id,
            status,
            total_processed: execution.processed,
            total_errors: metrics.totalErrors,
            details: {
                correlation_id: correlationId,
                trigger: "manual",
                request_base_url: request_base_url || null,
                changes_applied: execution.changes_applied,
                created: metrics.totalCreated,
                auto_linked: metrics.totalAutoLinked,
                linked_price_updated: metrics.totalLinkedPriceUpdated || 0,
                weighted_updated: metrics.totalWeightedPriceUpdated,
                weighted_pending_review: metrics.totalWeightedDeferred,
                linked_price_warnings: execution.linkedPriceWarnings,
                weighted_warnings: execution.weightedWarnings,
                errors: errors.slice(0, 20),
                catalog_source_total: execution.processed,
                catalog_created: metrics.totalCreated,
                catalog_auto_linked: metrics.totalAutoLinked,
                catalog_skipped_unchanged:
                    execution.processed -
                    metrics.totalCreated -
                    metrics.totalAutoLinked -
                    (metrics.totalLinkedPriceUpdated || 0) -
                    metrics.totalWeightedPriceUpdated,
            },
        })

        logContificoEvent(
            status === "partial" ? "warn" : "info",
            "Product catalog sync completed",
            {
                correlation_id: correlationId,
                operation: "product_sync.queue_run",
                processed: execution.processed,
                changes_applied: execution.changes_applied,
                errors: metrics.totalErrors,
                duration_ms: Date.now() - started,
            }
        )

        if (context.config.sync_products_enabled) {
            const stockRun = await ensureQueuedSyncRun({
                service,
                sync_type: "products-stock",
                config_id: context.config.id,
                requested_by: "catalog-auto-chain",
                parent_log_id: log.id,
                initial_details: {
                    request_base_url: request_base_url || null,
                },
            })

            if (stockRun.status === "queued") {
                const eventBus = scope.resolve(Modules.EVENT_BUS) as EventBusService
                await eventBus.emit({
                    name: CONTIFICO_PRODUCTS_STOCK_REQUESTED,
                    data: {
                        log_id: stockRun.id,
                        config_id: context.config.id,
                        request_base_url: request_base_url || null,
                    } satisfies ContificoSyncRequestedEvent,
                })
            }
        }
    } catch (error) {
        await failSyncRun(
            service,
            log.id,
            error instanceof Error ? error.message : "Error en sync",
            {
                correlation_id: correlationId,
                operation: "product_sync.queue_run",
                errors: errors.slice(0, 20),
            }
        )

        logContificoEvent(
            "error",
            "Product sync failed",
            {
                correlation_id: correlationId,
                operation: "product_sync.queue_run",
                duration_ms: Date.now() - started,
            },
            error
        )
    }
}

export async function processQueuedProductStockSyncJob(
    scope: { resolve: (key: string) => unknown },
    { log_id, request_base_url }: SyncRunnerOptions
) {
    bindContificoLogger(scope)
    const service = getContificoService(scope)
    const log = await ensureExistingQueuedLog(service, log_id)
    if (!log) {
        return
    }

    const correlationId =
        readLogCorrelationId(log.details) || createCorrelationId("contifico_product_stock")
    await markSyncRunRunning(service, log.id, {
        correlation_id: correlationId,
        request_base_url: request_base_url || null,
    })

    const streamState: { error?: string } = {}
    const stream = createSyncLogProgressStream(service, log, streamState)
    const context = await loadProductSyncContextFromScope({
        scope,
        stream,
        request_base_url: request_base_url || null,
    })

    if (!context) {
        await failSyncRun(service, log.id, streamState.error || "No se pudo inicializar el sync de stock.", {
            correlation_id: correlationId,
            operation: "product_stock.queue_init",
        })
        return
    }

    const started = Date.now()

    try {
        const execution = await executeStockSync(context)
        await completeSyncRun({
            service,
            log_id: log.id,
            status: execution.stockWarnings.length > 0 ? "partial" : "success",
            total_processed: execution.processed,
            total_errors: execution.stockWarnings.length,
            details: {
                correlation_id: correlationId,
                trigger: log.parent_log_id ? "catalog-child" : "manual",
                parent_log_id: log.parent_log_id || null,
                stock_candidates: execution.stockCandidates,
                stock_skipped_unchanged: execution.stockSkippedUnchanged,
                stock_detail_calls: execution.stockDetailCalls,
                stock_updated: execution.totalUpdated,
                stock_warnings: execution.stockWarnings,
            },
        })

        logContificoEvent(
            execution.stockWarnings.length > 0 ? "warn" : "info",
            "Product stock sync completed",
            {
                correlation_id: correlationId,
                operation: "product_stock.queue_run",
                processed: execution.processed,
                changes_applied: execution.totalUpdated,
                errors: execution.stockWarnings.length,
                duration_ms: Date.now() - started,
            }
        )
    } catch (error) {
        await failSyncRun(
            service,
            log.id,
            error instanceof Error ? error.message : "Error en sync de stock",
            {
                correlation_id: correlationId,
                operation: "product_stock.queue_run",
            }
        )
        logContificoEvent(
            "error",
            "Product stock sync failed",
            {
                correlation_id: correlationId,
                operation: "product_stock.queue_run",
                duration_ms: Date.now() - started,
            },
            error
        )
    }
}

async function executeCatalogSync(
    context: Awaited<ReturnType<typeof loadProductSyncContextFromScope>>,
    metrics: ProductSyncMetrics,
    errors: ProductSyncError[]
): Promise<ProductSyncExecutionResult> {
    if (!context) {
        throw new Error("No se pudo cargar el contexto de catálogo")
    }

    const productCatalog = await loadContificoCatalog(context)
    const medusaCatalog = await loadMedusaCatalog(context)
    const classification = await classifyProducts(
        context,
        productCatalog,
        medusaCatalog,
        metrics,
        errors
    )

    await createProductsFromContifico(
        context,
        productCatalog,
        medusaCatalog,
        classification,
        metrics,
        errors
    )

    const linkedPriceWarnings = await syncLinkedProductPrices(
        context,
        medusaCatalog,
        classification.linkedProducts,
        metrics,
        errors
    )

    const weightedWarnings = await syncWeightedLinkedProductPrices(
        context,
        medusaCatalog,
        classification.linkedProducts,
        metrics,
        errors
    )

    const changes_applied =
        metrics.totalCreated +
        metrics.totalAutoLinked +
        (metrics.totalLinkedPriceUpdated || 0) +
        metrics.totalWeightedPriceUpdated

    return {
        message: buildCatalogResultMessage(metrics),
        metrics,
        processed: productCatalog.activeProducts.length,
        changes_applied,
        linkedPriceWarnings,
        weightedWarnings,
    }
}

async function executeStockSync(
    context: Awaited<ReturnType<typeof loadProductSyncContextFromScope>>
): Promise<ProductStockExecutionResult> {
    if (!context) {
        throw new Error("No se pudo cargar el contexto de stock")
    }

    const productCatalog = await loadContificoCatalog(context)
    const mapsData = await loadProductEntityMaps(context)
    const linkedProducts = buildLinkedProductRefs(
        productCatalog.activeProducts,
        mapsData.mapByContifico
    )
    const medusaCatalog: MedusaCatalogData = {
        ...mapsData,
        medusaProducts: [] as MedusaProductRecord[],
        medusaById: new Map(),
        medusaBySku: new Map(),
        matchIndex: {
            candidatesById: new Map(),
            bySku: new Map(),
            byBarcode: new Map(),
            byExactTitleNormalized: new Map(),
            byTitleBucket: new Map(),
        },
        inventoryItemsBySku: new Map(),
        existingLevels: new Map(),
    }

    const stockResult = await syncLinkedProductStock(
        context,
        medusaCatalog,
        linkedProducts
    )

    return {
        message: buildStockResultMessage(stockResult),
        processed: linkedProducts.length,
        totalUpdated: stockResult.totalStockUpdated,
        stockWarnings: stockResult.stockWarnings,
        stockCandidates: stockResult.stockCandidates,
        stockSkippedUnchanged: stockResult.stockSkippedUnchanged,
        stockDetailCalls: stockResult.stockDetailCalls,
    }
}

function buildLinkedProductRefs(
    products: Array<{ id: string; codigo: string; nombre: string; cantidad_stock?: string | number | null }>,
    mapByContifico: MedusaCatalogData["mapByContifico"]
): LinkedProductRef[] {
    return products
        .map((cp) => {
            const map = mapByContifico.get(cp.id)
            if (!map) {
                return null
            }

            return {
                cp,
                medusaId: map.medusa_id,
                mappingMetadata: map.metadata || null,
            } as LinkedProductRef
        })
        .filter((item): item is LinkedProductRef => !!item)
}

function createEmptyProductSyncMetrics(): ProductSyncMetrics {
    return {
        totalCreated: 0,
        totalErrors: 0,
        totalStockUpdated: 0,
        totalAutoLinked: 0,
        totalImages: 0,
        totalVariants: 0,
        totalLinkedPriceUpdated: 0,
        totalWeightedPriceUpdated: 0,
        totalWeightedDeferred: 0,
    }
}

async function ensureExistingQueuedLog(
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

export function buildCatalogResultMessage(metrics: ProductSyncMetrics): string {
    const parts = [
        metrics.totalCreated > 0 ? `${metrics.totalCreated} creados` : null,
        metrics.totalAutoLinked > 0 ? `${metrics.totalAutoLinked} vinculados` : null,
        (metrics.totalLinkedPriceUpdated || 0) > 0
            ? `${metrics.totalLinkedPriceUpdated} precios sincronizados`
            : null,
        metrics.totalWeightedPriceUpdated > 0
            ? `${metrics.totalWeightedPriceUpdated} precios weighted actualizados`
            : null,
        metrics.totalWeightedDeferred > 0
            ? `${metrics.totalWeightedDeferred} weighted en revisión manual por falta de perfil aplicable`
            : null,
        metrics.totalErrors > 0 ? `${metrics.totalErrors} errores` : null,
    ].filter(Boolean)

    return `Sync completado: ${parts.join(", ") || "sin cambios"}`
}

function buildStockResultMessage(result: Awaited<ReturnType<typeof syncLinkedProductStock>>) {
    const parts = [
        result.totalStockUpdated > 0
            ? `${result.totalStockUpdated} stock actualizado`
            : null,
        result.stockSkippedUnchanged > 0
            ? `${result.stockSkippedUnchanged} sin cambios`
            : null,
        result.stockWarnings.length > 0
            ? `${result.stockWarnings.length} warnings`
            : null,
    ].filter(Boolean)

    return `Sync de stock completado: ${parts.join(", ") || "sin cambios"}`
}
