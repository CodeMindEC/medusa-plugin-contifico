import { ContificoClient } from "../../../../../lib/client"
import { asProductMapMetadata, buildProductMapMetadata } from "../../../../../lib/contifico-metadata"
import { getEffectiveMappingMode } from "../../../../../lib/contifico-weighted"
import { normalizeProductSyncState } from "../../../../../lib/product-sync-state"
import { resolveStockPolicy } from "../../../../../lib/strategies/stock"
import { normalize } from "../../../../../lib/similarity"
import { loadMedusaInventorySnapshot } from "./product-sync-config"
import { updateAndCacheProductEntityMap } from "./product-map-cache"
import type {
    LinkedProductRef,
    MedusaCatalogData,
    ProductStockWarning,
    ProductSyncContext,
} from "./types"

const STOCK_LOAD_BATCH_SIZE = 15
const INVENTORY_WRITE_BATCH_SIZE = 50
const MAP_UPDATE_BATCH_SIZE = 25

interface StockBodegaSummary {
    bodega_id: string
    bodega_nombre: string
    cantidad: number
}

interface LinkedStockCandidate {
    item: LinkedProductRef
    totalStock: number
    previousTotal: number | null
}

interface PendingMetadataUpdate {
    contifico_id: string
    medusa_id: string
    metadata: ReturnType<typeof buildProductMapMetadata>
}

export async function syncLinkedProductStock(
    context: ProductSyncContext,
    medusaCatalog: MedusaCatalogData,
    linkedProducts: LinkedProductRef[]
): Promise<{
    totalStockUpdated: number
    stockWarnings: ProductStockWarning[]
    stockCandidates: number
    stockSkippedUnchanged: number
    stockDetailCalls: number
}> {
    const stockWarnings: ProductStockWarning[] = []
    const stockPolicy = resolveStockPolicy(context.config.advanced_settings.stock)

    const stockEligibleProducts = linkedProducts.filter(
        (product) => getEffectiveMappingMode(context.config, product.mappingMetadata) !== "weighted"
    )

    if (
        !context.primaryLocationId ||
        stockEligibleProducts.length === 0 ||
        !stockPolicy.should_sync_levels
    ) {
        return {
            totalStockUpdated: 0,
            stockWarnings,
            stockCandidates: stockEligibleProducts.length,
            stockSkippedUnchanged: stockEligibleProducts.length,
            stockDetailCalls: 0,
        }
    }

    const candidates = buildStockCandidates(stockEligibleProducts)
    const changedCandidates = candidates.filter(
        (candidate) => candidate.previousTotal !== candidate.totalStock
    )
    const relevantSkus = changedCandidates.map((candidate) => candidate.item.cp.codigo)

    context.stream.progress(
        "stock",
        `Revisando stock de ${stockEligibleProducts.length} producto(s)...`,
        80
    )

    const inventorySnapshot = await loadMedusaInventorySnapshot(
        context,
        relevantSkus,
        [
            ...Array.from(context.bodegaToLocation.values()),
            ...(context.primaryLocationId ? [context.primaryLocationId] : []),
        ]
    )
    const stockCacheResult = stockPolicy.use_primary_only
        ? { cache: new Map<string, StockBodegaSummary[]>(), detailCalls: 0 }
        : await loadStockCache(
              context,
              new ContificoClient({ apiKey: context.clientApiKey }),
              changedCandidates,
              inventorySnapshot.inventoryItemsBySku
          )

    context.stream.progress("stock", "Procesando niveles de inventario...", 87)

    const levelsToCreate: Array<{
        inventory_item_id: string
        location_id: string
        stocked_quantity: number
    }> = []
    const levelsToUpdate: Array<{
        inventory_item_id: string
        location_id: string
        stocked_quantity: number
    }> = []
    const metadataUpdates: PendingMetadataUpdate[] = []

    let totalStockUpdated = 0

    for (const candidate of candidates) {
        const mappingMetadata = asProductMapMetadata(candidate.item.mappingMetadata)
        const inventoryItem = inventorySnapshot.inventoryItemsBySku.get(
            normalize(candidate.item.cp.codigo)
        )

        if (!inventoryItem) {
            continue
        }

        if (candidate.previousTotal === candidate.totalStock) {
            continue
        }

        const bodegaStocks = stockCacheResult.cache.get(candidate.item.cp.id) || []
        const stockEndpointOk = stockCacheResult.cache.has(candidate.item.cp.id)
        const sumaBodegas = bodegaStocks.reduce((acc, item) => acc + item.cantidad, 0)
        const canUseBodegaDistribution =
            stockEndpointOk &&
            bodegaStocks.length > 0 &&
            !stockPolicy.use_primary_only &&
            (sumaBodegas === candidate.totalStock ||
                context.config.advanced_settings.stock.mismatch_policy ===
                    "use_bodega_sum")

        if (canUseBodegaDistribution) {
            for (const bodegaStock of bodegaStocks) {
                const locationId = context.bodegaToLocation.get(bodegaStock.bodega_id)
                if (!locationId) {
                    continue
                }

                const levelKey = `${inventoryItem.id}:${locationId}`
                if (inventorySnapshot.existingLevels.has(levelKey)) {
                    levelsToUpdate.push({
                        inventory_item_id: inventoryItem.id,
                        location_id: locationId,
                        stocked_quantity: bodegaStock.cantidad,
                    })
                } else {
                    levelsToCreate.push({
                        inventory_item_id: inventoryItem.id,
                        location_id: locationId,
                        stocked_quantity: bodegaStock.cantidad,
                    })
                }
            }

            if (stockEndpointOk && sumaBodegas !== candidate.totalStock) {
                stockWarnings.push({
                    producto: candidate.item.cp.nombre,
                    codigo: candidate.item.cp.codigo,
                    cantidad_stock: candidate.totalStock,
                    suma_bodegas: sumaBodegas,
                    bodegas_detalle: bodegaStocks.map((item) => ({
                        nombre: item.bodega_nombre,
                        cantidad: item.cantidad,
                    })),
                    accion: `Se uso la suma de bodegas (${sumaBodegas}) por politica stock.mismatch_policy=use_bodega_sum`,
                })
            }
        } else {
            const primaryKey = `${inventoryItem.id}:${context.primaryLocationId}`
            if (inventorySnapshot.existingLevels.has(primaryKey)) {
                levelsToUpdate.push({
                    inventory_item_id: inventoryItem.id,
                    location_id: context.primaryLocationId,
                    stocked_quantity: candidate.totalStock,
                })
            } else {
                levelsToCreate.push({
                    inventory_item_id: inventoryItem.id,
                    location_id: context.primaryLocationId,
                    stocked_quantity: candidate.totalStock,
                })
            }

            for (const locationId of context.bodegaToLocation.values()) {
                if (locationId === context.primaryLocationId) {
                    continue
                }

                const levelKey = `${inventoryItem.id}:${locationId}`
                if (inventorySnapshot.existingLevels.has(levelKey)) {
                    levelsToUpdate.push({
                        inventory_item_id: inventoryItem.id,
                        location_id: locationId,
                        stocked_quantity: 0,
                    })
                }
            }

            if (stockEndpointOk && sumaBodegas !== candidate.totalStock) {
                stockWarnings.push({
                    producto: candidate.item.cp.nombre,
                    codigo: candidate.item.cp.codigo,
                    cantidad_stock: candidate.totalStock,
                    suma_bodegas: sumaBodegas,
                    bodegas_detalle: bodegaStocks.map((item) => ({
                        nombre: item.bodega_nombre,
                        cantidad: item.cantidad,
                    })),
                    accion:
                        stockPolicy.use_primary_only
                            ? `Stock total (${candidate.totalStock}) asignado a ubicacion principal por stock.mode=primary_only`
                            : `Stock total (${candidate.totalStock}) asignado a ubicacion principal`,
                })
            }
        }

        metadataUpdates.push({
            contifico_id: candidate.item.cp.id,
            medusa_id: candidate.item.medusaId,
            metadata: buildProductMapMetadata({
                ...mappingMetadata,
                sync_state: {
                    ...normalizeProductSyncState(mappingMetadata.sync_state),
                    last_stock_total: candidate.totalStock,
                    last_stock_hash: buildStockHash(
                        canUseBodegaDistribution ? bodegaStocks : null,
                        candidate.totalStock
                    ),
                    last_stock_sync_at: new Date().toISOString(),
                    cleanup_state:
                        mappingMetadata.sync_state?.cleanup_state === "failed"
                            ? "failed"
                            : null,
                    cleanup_last_error:
                        mappingMetadata.sync_state?.cleanup_state === "failed"
                            ? mappingMetadata.sync_state.cleanup_last_error || null
                            : null,
                },
            }),
        })
        totalStockUpdated++
    }

    context.stream.progress("stock", "Guardando niveles de inventario...", 91)

    for (let index = 0; index < levelsToCreate.length; index += INVENTORY_WRITE_BATCH_SIZE) {
        const batch = levelsToCreate.slice(index, index + INVENTORY_WRITE_BATCH_SIZE)
        try {
            await context.services.inventoryService.createInventoryLevels(batch)
        } catch {
            await Promise.all(
                batch.map(async (item) => {
                    try {
                        await context.services.inventoryService.createInventoryLevels(item)
                    } catch {
                        return null
                    }
                    return null
                })
            )
        }
    }

    for (let index = 0; index < levelsToUpdate.length; index += INVENTORY_WRITE_BATCH_SIZE) {
        const batch = levelsToUpdate.slice(index, index + INVENTORY_WRITE_BATCH_SIZE)
        await Promise.all(
            batch.map((item) =>
                context.services.inventoryService.updateInventoryLevels(item)
            )
        )
    }

    for (let index = 0; index < metadataUpdates.length; index += MAP_UPDATE_BATCH_SIZE) {
        const batch = metadataUpdates.slice(index, index + MAP_UPDATE_BATCH_SIZE)
        await Promise.all(
            batch.map((item) =>
                updateAndCacheProductEntityMap(context, medusaCatalog, {
                    medusa_id: item.medusa_id,
                    contifico_id: item.contifico_id,
                    metadata: item.metadata,
                })
            )
        )
    }

    return {
        totalStockUpdated,
        stockWarnings,
        stockCandidates: stockEligibleProducts.length,
        stockSkippedUnchanged: stockEligibleProducts.length - changedCandidates.length,
        stockDetailCalls: stockCacheResult.detailCalls,
    }
}

function buildStockCandidates(linkedProducts: LinkedProductRef[]): LinkedStockCandidate[] {
    return linkedProducts.map((item) => {
        const syncState = normalizeProductSyncState(item.mappingMetadata?.sync_state)
        return {
            item,
            totalStock: Math.max(
                0,
                Math.floor(parseFloat(item.cp.cantidad_stock ?? "0"))
            ),
            previousTotal:
                typeof syncState?.last_stock_total === "number"
                    ? syncState.last_stock_total
                    : null,
        }
    })
}

async function loadStockCache(
    context: ProductSyncContext,
    client: ContificoClient,
    changedProducts: LinkedStockCandidate[],
    inventoryItemsBySku: Map<string, { id: string; sku: string }>
) {
    const stockCache = new Map<string, StockBodegaSummary[]>()
    let detailCalls = 0

    if (context.bodegaIds.length === 0) {
        return { cache: stockCache, detailCalls }
    }

    const productsWithInventory = changedProducts.filter(({ item }) =>
        inventoryItemsBySku.has(normalize(item.cp.codigo))
    )

    for (let index = 0; index < productsWithInventory.length; index += STOCK_LOAD_BATCH_SIZE) {
        const batch = productsWithInventory.slice(index, index + STOCK_LOAD_BATCH_SIZE)
        if (index % 30 === 0) {
            context.stream.progress(
                "stock",
                `Descargando stock ${index + 1}/${productsWithInventory.length}...`,
                80 + Math.round(7 * (index / Math.max(productsWithInventory.length, 1)))
            )
        }

        const results = await Promise.allSettled(
            batch.map(({ item }) =>
                client.getStockAll(item.cp.id).then((data) => ({
                    id: item.cp.id,
                    data,
                }))
            )
        )

        detailCalls += batch.length
        for (const result of results) {
            if (result.status === "fulfilled") {
                stockCache.set(
                    result.value.id,
                    result.value.data.map((item) => ({
                        bodega_id: item.bodega_id,
                        bodega_nombre: item.bodega_nombre,
                        cantidad: Math.max(
                            0,
                            Math.floor(
                                typeof item.cantidad === "string"
                                    ? parseFloat(item.cantidad)
                                    : item.cantidad
                            )
                        ),
                    }))
                )
            }
        }
    }

    return { cache: stockCache, detailCalls }
}

function buildStockHash(
    detailedStock: StockBodegaSummary[] | null,
    totalStock: number
) {
    if (!detailedStock || detailedStock.length === 0) {
        return `total:${totalStock}`
    }

    return JSON.stringify({
        total: totalStock,
        bodegas: detailedStock.map((item) => ({
            id: item.bodega_id,
            cantidad: item.cantidad,
        })),
    })
}
