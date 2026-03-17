/**
 * Post-relink operations: cleanup old plugin-created products and
 * refresh prices for the newly linked product.
 */

import type { MedusaRequest } from "@medusajs/framework/http"
import type {
    IInventoryService,
    IPricingModuleService,
    IProductModuleService,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ContificoClient } from "../client"
import {
    asProductMapMetadata,
    resolveProductLinkOrigin,
    type ProductEntityMapMetadata,
} from "../contifico-metadata"
import { getErrorMessage, logContificoEvent } from "../observability"
import {
    deleteInventoryItemsAfterProductCleanup,
    deleteInventoryLevelsForItems,
    loadInventoryItemIdsForProducts,
    type ProductInventoryQueryGraphService,
} from "../product-inventory-cleanup"
import { buildCatalogFingerprint } from "../../api/admin/contifico/sync/products/product-sync-fingerprint"
import { syncLinkedProductPrices } from "../../api/admin/contifico/sync/products/linked-price-sync"
import { syncWeightedLinkedProductPrices } from "../../api/admin/contifico/sync/products/weighted-sync"
import type {
    LinkService,
    MedusaCatalogData,
    MedusaProductRecord,
    ProductSyncContext,
    ProductSyncError,
    ProductSyncMetrics,
} from "../../api/admin/contifico/sync/products/types"
import { getContificoConfig, getContificoService } from "../../api/admin/contifico/shared"
import { captureProductPriceSnapshot } from "../product-price-snapshot"

type ProductMapService = ReturnType<typeof getContificoService>
type ProductCleanupService = Pick<IProductModuleService, "deleteProducts" | "listProducts">
type InventoryCleanupService = Pick<
    IInventoryService,
    "listInventoryLevels" | "deleteInventoryLevels" | "deleteInventoryItems"
>

export interface ProductRelinkCleanupServices {
    productService?: ProductCleanupService
    inventoryService?: InventoryCleanupService
    query?: ProductInventoryQueryGraphService
}

export interface RelinkPriceRefreshResult {
    warning?: string
    price_updated: number
    weighted_price_updated: number
}

export { captureProductPriceSnapshot }

// ── Cleanup ──────────────────────────────────────────────

export async function cleanupRelinkedPluginCreatedProduct({
    cleanupServices,
    metadata,
    old_medusa_id,
    new_medusa_id,
    contifico_id,
    correlationId,
}: {
    cleanupServices?: ProductRelinkCleanupServices
    metadata: ProductEntityMapMetadata
    old_medusa_id: string
    new_medusa_id: string
    contifico_id: string
    correlationId: string
}) {
    const productService = cleanupServices?.productService
    if (
        !productService ||
        old_medusa_id === new_medusa_id ||
        resolveProductLinkOrigin(metadata) !== "plugin_created"
    ) {
        return
    }

    try {
        const inventoryService = cleanupServices?.inventoryService
        const query = cleanupServices?.query
        const { allInventoryItemIds } =
            inventoryService && query
                ? await loadInventoryItemIdsForProducts({
                    productService,
                    query,
                    productIds: [old_medusa_id],
                })
                : { allInventoryItemIds: [] as string[] }

        if (inventoryService && allInventoryItemIds.length > 0) {
            await deleteInventoryLevelsForItems(inventoryService, allInventoryItemIds)
        }

        await productService.deleteProducts([old_medusa_id])

        if (inventoryService && allInventoryItemIds.length > 0) {
            const inventoryErrors = await deleteInventoryItemsAfterProductCleanup(
                inventoryService,
                allInventoryItemIds
            )

            if (inventoryErrors.length > 0) {
                logContificoEvent(
                    "warn",
                    "Relink cleanup left orphan inventory items",
                    {
                        correlation_id: correlationId,
                        operation: "product_links.relink_cleanup",
                        contifico_id,
                        old_medusa_id,
                        new_medusa_id,
                        inventory_errors: inventoryErrors.length,
                    }
                )
            }
        }

        logContificoEvent("info", "Relink cleanup deleted old plugin-created product", {
            correlation_id: correlationId,
            operation: "product_links.relink_cleanup",
            contifico_id,
            old_medusa_id,
            new_medusa_id,
        })
    } catch (error) {
        logContificoEvent(
            "warn",
            "Relink cleanup could not delete old plugin-created product",
            {
                correlation_id: correlationId,
                operation: "product_links.relink_cleanup",
                contifico_id,
                old_medusa_id,
                new_medusa_id,
            },
            error
        )
    }
}

// ── Price Refresh ────────────────────────────────────────

export async function refreshRelinkedLinkedPrices({
    req,
    service,
    contifico_id,
    medusa_id,
    correlationId,
}: {
    req: MedusaRequest
    service: ProductMapService
    contifico_id: string
    medusa_id: string
    correlationId: string
}): Promise<RelinkPriceRefreshResult> {
    try {
        const { normalized: config } = await getContificoConfig(service)
        if (!config?.api_key) {
            return {
                warning:
                    "El producto se re-vinculo, pero no se pudo refrescar el precio porque falta la API Key de Contifico.",
                price_updated: 0,
                weighted_price_updated: 0,
            }
        }

        const [mapRecords] = await service.listAndCountContificoEntityMaps({
            entity_type: "product",
            medusa_id,
            contifico_id,
        })
        const mapRecord = mapRecords[0]
        if (!mapRecord) {
            return {
                warning:
                    "El producto se re-vinculo, pero no se encontro el nuevo mapeo para refrescar el precio.",
                price_updated: 0,
                weighted_price_updated: 0,
            }
        }

        const productService = req.scope.resolve(Modules.PRODUCT) as IProductModuleService
        const pricingService = req.scope.resolve(
            Modules.PRICING
        ) as IPricingModuleService
        const query = req.scope.resolve("query") as ProductInventoryQueryGraphService
        const link = req.scope.resolve(
            ContainerRegistrationKeys.LINK
        ) as LinkService
        const medusaProducts = (await productService.listProducts(
            { id: [medusa_id] },
            { relations: ["variants"], take: 2 }
        )) as MedusaProductRecord[]
        const medusaProduct = medusaProducts[0]

        if (!medusaProduct) {
            return {
                warning:
                    "El producto se re-vinculo, pero el producto Medusa ya no existe para refrescar el precio.",
                price_updated: 0,
                weighted_price_updated: 0,
            }
        }

        const client = new ContificoClient({ apiKey: config.api_key })
        const contificoProduct = await client.getProducto(contifico_id)
        const context = buildRelinkWeightedSyncContext({
            service,
            productService,
            pricingService,
            query,
            link,
            config,
        })
        const medusaCatalog = buildRelinkWeightedMedusaCatalog({
            mapRecord,
            medusaProduct,
        })
        const metrics = createEmptyRelinkSyncMetrics()
        const errors: ProductSyncError[] = []
        const linkedWarnings = await syncLinkedProductPrices(
            context,
            medusaCatalog,
            [
                {
                    cp: contificoProduct,
                    medusaId: medusa_id,
                    mappingMetadata: asProductMapMetadata(mapRecord.metadata),
                    catalogFingerprint: buildCatalogFingerprint(contificoProduct),
                },
            ],
            metrics,
            errors
        )
        const warnings = await syncWeightedLinkedProductPrices(
            context,
            medusaCatalog,
            [
                {
                    cp: contificoProduct,
                    medusaId: medusa_id,
                    mappingMetadata: asProductMapMetadata(mapRecord.metadata),
                    catalogFingerprint: buildCatalogFingerprint(contificoProduct),
                },
            ],
            metrics,
            errors
        )
        const totalPriceUpdated =
            (metrics.totalLinkedPriceUpdated || 0) + metrics.totalWeightedPriceUpdated

        if (errors.length > 0) {
            logContificoEvent("warn", "Relink price refresh failed", {
                correlation_id: correlationId,
                operation: "product_links.relink_price_refresh",
                contifico_id,
                medusa_id,
                errors: errors.length,
                first_error: errors[0]?.error || null,
            })

            return {
                warning: `El vínculo se actualizo, pero no se pudo refrescar el precio: ${errors[0].error}`,
                price_updated: totalPriceUpdated,
                weighted_price_updated: metrics.totalWeightedPriceUpdated,
            }
        }

        const allWarnings = [...linkedWarnings, ...warnings]

        if (allWarnings.length > 0) {
            logContificoEvent("warn", "Relink price refresh needs review", {
                correlation_id: correlationId,
                operation: "product_links.relink_price_refresh",
                contifico_id,
                medusa_id,
                warnings: allWarnings.length,
                first_warning: allWarnings[0]?.message || null,
            })

            return {
                warning: `El vínculo se actualizo, pero el precio requiere revision: ${allWarnings[0].message}`,
                price_updated: totalPriceUpdated,
                weighted_price_updated: metrics.totalWeightedPriceUpdated,
            }
        }

        if (totalPriceUpdated > 0) {
            logContificoEvent("info", "Relink price refreshed", {
                correlation_id: correlationId,
                operation: "product_links.relink_price_refresh",
                contifico_id,
                medusa_id,
                updated_prices: totalPriceUpdated,
            })
        }

        return {
            price_updated: totalPriceUpdated,
            weighted_price_updated: metrics.totalWeightedPriceUpdated,
        }
    } catch (error) {
        const message = getErrorMessage(error, "Error interno")
        logContificoEvent(
            "warn",
            "Relink price refresh failed unexpectedly",
            {
                correlation_id: correlationId,
                operation: "product_links.relink_price_refresh",
                contifico_id,
                medusa_id,
            },
            error
        )

        return {
            warning: `El vínculo se actualizo, pero no se pudo refrescar el precio: ${message}`,
            price_updated: 0,
            weighted_price_updated: 0,
        }
    }
}

// ── Private helpers ──────────────────────────────────────

function buildRelinkWeightedSyncContext({
    service,
    productService,
    pricingService,
    query,
    link,
    config,
}: {
    service: ProductMapService
    productService: IProductModuleService
    pricingService: IPricingModuleService
    query: ProductInventoryQueryGraphService
    link: LinkService
    config: NonNullable<Awaited<ReturnType<typeof getContificoConfig>>["normalized"]>
}): ProductSyncContext {
    const stream: ProductSyncContext["stream"] = {
        progress: () => undefined,
        result: () => undefined,
        error: () => undefined,
    }

    return {
        req: null,
        stream,
        services: {
            contificoService: service,
            productService,
            query,
            pricingService,
            link,
        } as unknown as ProductSyncContext["services"],
        config,
        clientApiKey: config.api_key,
        request_base_url: null,
        bodegaIds: config.bodega_ids || [],
        shouldManageInventory: config.manage_inventory ?? false,
        shouldAllowBackorder: config.allow_backorder ?? false,
        variantMode: config.variant_mode,
        shippingProfileId: config.shipping_profile_id || null,
        salesChannelId: config.sales_channel_id || null,
        contificoBodegas: [],
        bodegaMap: new Map(),
        bodegaToLocation: new Map(),
        primaryLocationId: null,
    }
}

function buildRelinkWeightedMedusaCatalog({
    mapRecord,
    medusaProduct,
}: {
    mapRecord: {
        id: string
        medusa_id: string
        contifico_id: string
        metadata?: unknown
    }
    medusaProduct: MedusaProductRecord
}): MedusaCatalogData {
    return {
        existingMaps: [
            {
                id: mapRecord.id,
                medusa_id: mapRecord.medusa_id,
                contifico_id: mapRecord.contifico_id,
                metadata: asProductMapMetadata(mapRecord.metadata),
            },
        ],
        mapByContifico: new Map([
            [
                mapRecord.contifico_id,
                {
                    id: mapRecord.id,
                    medusa_id: mapRecord.medusa_id,
                    contifico_id: mapRecord.contifico_id,
                    metadata: asProductMapMetadata(mapRecord.metadata),
                },
            ],
        ]),
        mapByMedusa: new Map([
            [
                mapRecord.medusa_id,
                {
                    id: mapRecord.id,
                    medusa_id: mapRecord.medusa_id,
                    contifico_id: mapRecord.contifico_id,
                    metadata: asProductMapMetadata(mapRecord.metadata),
                },
            ],
        ]),
        medusaProducts: [medusaProduct],
        medusaById: new Map([[medusaProduct.id, medusaProduct]]),
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
}

function createEmptyRelinkSyncMetrics(): ProductSyncMetrics {
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
