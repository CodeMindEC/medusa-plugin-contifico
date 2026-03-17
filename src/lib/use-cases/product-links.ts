import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type {
    IInventoryService,
    IPricingModuleService,
    IProductModuleService,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ProductRulesOverride } from "../advanced-settings"
import { ContificoClient } from "../client"
import {
    asProductMapMetadata,
    buildProductMapMetadata,
    resolveProductLinkOrigin,
    type ProductEntityMapMetadata,
} from "../contifico-metadata"
import {
    isVariantMode,
    isWeightedPvpField,
    type VariantMode,
    type WeightedPvpField,
} from "../contifico-config"
import {
    createCorrelationId,
    getErrorMessage,
    logContificoEvent,
} from "../observability"
import {
    deleteInventoryItemsAfterProductCleanup,
    deleteInventoryLevelsForItems,
    loadInventoryItemIdsForProducts,
    type ProductInventoryQueryGraphService,
} from "../product-inventory-cleanup"
import { captureProductPriceSnapshot } from "../product-price-snapshot"
import {
    buildCatalogFingerprint,
} from "../../api/admin/contifico/sync/products/product-sync-fingerprint"
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

const PRODUCT_RULE_OVERRIDE_SECTIONS = [
    "pricing",
    "weighted",
    "stock",
    "invoicing",
] as const

interface ProductLinkInput {
    contifico_id: string
    medusa_id: string
    contifico_codigo?: string
    contifico_nombre?: string
    contifico_imagen?: string | null
    mapping_mode_override?: VariantMode | null
    weighted_pvp_field?: WeightedPvpField | null
    product_rules_override?: ProductRulesOverride | null
    weighted_price_sync_override?: boolean | null
}

type ProductMapService = ReturnType<typeof getContificoService>
type ProductCleanupService = Pick<IProductModuleService, "deleteProducts" | "listProducts">
type InventoryCleanupService = Pick<
    IInventoryService,
    "listInventoryLevels" | "deleteInventoryLevels" | "deleteInventoryItems"
>
interface ProductRelinkCleanupServices {
    productService?: ProductCleanupService
    inventoryService?: InventoryCleanupService
    query?: ProductInventoryQueryGraphService
}

interface RelinkPriceRefreshResult {
    warning?: string
    price_updated: number
    weighted_price_updated: number
}

export async function runCreateProductLinks(req: MedusaRequest, res: MedusaResponse) {
    const correlationId = createCorrelationId("contifico_product_link_create")

    try {
        const { links } = req.body as { links: ProductLinkInput[] }
        if (!links || !Array.isArray(links) || links.length === 0) {
            res.status(400).json({ error: "Se requiere un array de links." })
            return
        }

        const service = getContificoService(req.scope)
        const productService: IProductModuleService = req.scope.resolve(Modules.PRODUCT)
        const query = req.scope.resolve("query") as ProductInventoryQueryGraphService
        const snapshotByProductId = await captureProductPriceSnapshot({
            productService,
            query,
            productIds: links.map((link) => link.medusa_id).filter(Boolean),
        })
        const result = await createProductLinks(
            service,
            links,
            correlationId,
            snapshotByProductId
        )
        res.json(result)
    } catch (error) {
        res.status(500).json({
            error: `Error vinculando productos: ${getErrorMessage(error, "Error interno")}`,
        })
    }
}

export async function runDeleteProductLink(req: MedusaRequest, res: MedusaResponse) {
    const correlationId = createCorrelationId("contifico_product_link_delete")

    try {
        const { medusa_id } = req.body as { medusa_id: string }
        if (!medusa_id) {
            res.status(400).json({ error: "Se requiere medusa_id." })
            return
        }

        const service = getContificoService(req.scope)
        const deleted = await deleteProductLink(service, medusa_id, correlationId)
        if (!deleted) {
            res.status(404).json({ error: "No se encontro el mapeo." })
            return
        }

        res.json({ ok: true, correlation_id: correlationId })
    } catch (error) {
        res.status(500).json({
            error: `Error desvinculando: ${getErrorMessage(error, "Error interno")}`,
        })
    }
}

export async function runRelinkProductLink(req: MedusaRequest, res: MedusaResponse) {
    const correlationId = createCorrelationId("contifico_product_link_update")

    try {
        const service = getContificoService(req.scope)
        const productService: IProductModuleService = req.scope.resolve(Modules.PRODUCT)
        const inventoryService: IInventoryService = req.scope.resolve(Modules.INVENTORY)
        const query = req.scope.resolve("query") as ProductInventoryQueryGraphService
        const { new_medusa_id } = req.body as { new_medusa_id?: string }
        const snapshotByProductId = new_medusa_id
            ? await captureProductPriceSnapshot({
                  productService,
                  query,
                  productIds: [new_medusa_id],
              })
            : new Map()
        const result = await updateProductLink(
            service,
            req.body as {
                contifico_id: string
                new_medusa_id?: string
                mapping_mode_override?: VariantMode | null
                weighted_pvp_field?: WeightedPvpField | null
                product_rules_override?: ProductRulesOverride | null
                weighted_price_sync_override?: boolean | null
            },
            correlationId,
            snapshotByProductId,
            {
                productService,
                inventoryService,
                query,
            }
        )

        if (result.status === "missing_contifico_id") {
            res.status(400).json({ error: "Se requiere contifico_id." })
            return
        }
        if (result.status === "not_found") {
            res.status(404).json({
                error: "No se encontró el mapeo para este producto de Contifico.",
            })
            return
        }
        if (result.status === "conflict") {
            res.status(409).json({
                error: `El producto Medusa ya está vinculado a otro producto de Contifico (${result.contifico_id_conflict}).`,
            })
            return
        }

        const priceRefresh =
            result.status === "relinked"
                ? await refreshRelinkedLinkedPrices({
                      req,
                      service,
                      contifico_id: (req.body as { contifico_id: string }).contifico_id,
                      medusa_id: result.payload.new_medusa_id,
                      correlationId,
                  })
                : null

        res.json({
            ok: true,
            correlation_id: correlationId,
            ...result.payload,
            ...(priceRefresh?.warning ? { warning: priceRefresh.warning } : {}),
            ...(priceRefresh
                ? {
                      price_updated: priceRefresh.price_updated,
                      weighted_price_updated: priceRefresh.weighted_price_updated,
                  }
                : {}),
        })
    } catch (error) {
        res.status(500).json({
            error: `Error re-vinculando: ${getErrorMessage(error, "Error interno")}`,
        })
    }
}

export async function createProductLinks(
    service: ProductMapService,
    links: ProductLinkInput[],
    correlationId: string,
    snapshotByProductId?: Map<string, ProductEntityMapMetadata["sync_snapshot"]>
) {
    const created: Array<{ medusa_id: string; contifico_id: string }> = []
    const skipped: Array<{
        medusa_id: string
        contifico_id: string
        reason: string
    }> = []

    for (const link of links) {
        if (!link.contifico_id || !link.medusa_id) {
            skipped.push({
                contifico_id: link.contifico_id,
                medusa_id: link.medusa_id,
                reason: "Faltan contifico_id o medusa_id",
            })
            continue
        }

        const [existingByMedusa] = await service.listAndCountContificoEntityMaps({
            entity_type: "product",
            medusa_id: link.medusa_id,
        })
        if (existingByMedusa.length > 0) {
            skipped.push({
                medusa_id: link.medusa_id,
                contifico_id: link.contifico_id,
                reason:
                    existingByMedusa[0].contifico_id === link.contifico_id
                        ? "El vínculo ya existe"
                        : "Ya existe un mapeo para este producto de Medusa",
            })
            continue
        }

        const [existingByContifico] = await service.listAndCountContificoEntityMaps({
            entity_type: "product",
            contifico_id: link.contifico_id,
        })
        if (existingByContifico.length > 0) {
            skipped.push({
                medusa_id: link.medusa_id,
                contifico_id: link.contifico_id,
                reason:
                    existingByContifico[0].medusa_id === link.medusa_id
                        ? "El vínculo ya existe"
                        : "Ya existe un mapeo para este producto de Contifico",
            })
            continue
        }

        const metadata: ProductEntityMapMetadata = {
            codigo: link.contifico_codigo,
            nombre: link.contifico_nombre,
            imagen: link.contifico_imagen || null,
            link_origin: "manual",
            ...(isVariantMode(link.mapping_mode_override)
                ? { mapping_mode_override: link.mapping_mode_override }
                : {}),
            ...(isWeightedPvpField(link.weighted_pvp_field)
                ? { weighted_pvp_field: link.weighted_pvp_field }
                : {}),
            sync_snapshot: snapshotByProductId?.get(link.medusa_id) || undefined,
            ...withProductRulesOverride(
                buildMergedProductRulesOverride(
                    undefined,
                    link.product_rules_override,
                    link.weighted_price_sync_override
                )
            ),
        }

        await service.createContificoEntityMaps({
            entity_type: "product",
            medusa_id: link.medusa_id,
            contifico_id: link.contifico_id,
            metadata: buildProductMapMetadata(metadata),
        })

        created.push({
            medusa_id: link.medusa_id,
            contifico_id: link.contifico_id,
        })
    }

    logContificoEvent("info", "Product links processed", {
        correlation_id: correlationId,
        operation: "product_links.create",
        created: created.length,
        skipped: skipped.length,
    })

    return {
        linked: created.length,
        skipped: skipped.length,
        correlation_id: correlationId,
        details: { created, skipped },
    }
}

export async function deleteProductLink(
    service: ProductMapService,
    medusaId: string,
    correlationId: string
) {
    const [existing] = await service.listAndCountContificoEntityMaps({
        entity_type: "product",
        medusa_id: medusaId,
    })

    if (existing.length === 0) {
        return false
    }

    await service.deleteContificoEntityMaps(existing[0].id)
    logContificoEvent("info", "Product link deleted", {
        correlation_id: correlationId,
        operation: "product_links.delete",
        medusa_id: medusaId,
        contifico_id: existing[0].contifico_id,
    })
    return true
}

export async function updateProductLink(
    service: ProductMapService,
    input: {
        contifico_id: string
        new_medusa_id?: string
        mapping_mode_override?: VariantMode | null
        weighted_pvp_field?: WeightedPvpField | null
        product_rules_override?: ProductRulesOverride | null
        weighted_price_sync_override?: boolean | null
    },
    correlationId: string,
    snapshotByProductId?: Map<string, ProductEntityMapMetadata["sync_snapshot"]>,
    cleanupServices?: ProductRelinkCleanupServices
): Promise<
    | { status: "missing_contifico_id" }
    | { status: "not_found" }
    | { status: "conflict"; contifico_id_conflict: string }
    | { status: "updated"; payload: { medusa_id: string } }
    | {
          status: "relinked"
          payload: { old_medusa_id: string; new_medusa_id: string }
      }
> {
    const { contifico_id, new_medusa_id } = input
    if (!contifico_id) {
        return { status: "missing_contifico_id" }
    }

    const [existing] = await service.listAndCountContificoEntityMaps({
        entity_type: "product",
        contifico_id,
    })
    if (existing.length === 0) {
        return { status: "not_found" }
    }

    const oldMeta = asProductMapMetadata(existing[0].metadata)
    const nextMeta = buildProductMapMetadata({
        ...oldMeta,
        ...(input.mapping_mode_override === null
            ? { mapping_mode_override: undefined }
            : isVariantMode(input.mapping_mode_override)
              ? { mapping_mode_override: input.mapping_mode_override }
              : {}),
        ...(input.weighted_pvp_field === null
            ? { weighted_pvp_field: undefined }
            : isWeightedPvpField(input.weighted_pvp_field)
              ? { weighted_pvp_field: input.weighted_pvp_field }
              : {}),
        ...withProductRulesOverride(
            buildMergedProductRulesOverride(
                oldMeta.product_rules_override || null,
                input.product_rules_override,
                input.weighted_price_sync_override
            )
        ),
        link_origin: resolveProductLinkOrigin(oldMeta),
    })

    if (!new_medusa_id || new_medusa_id === existing[0].medusa_id) {
        await service.updateContificoEntityMaps({
            id: existing[0].id,
            metadata: nextMeta,
        })
        logContificoEvent("info", "Product link metadata updated", {
            correlation_id: correlationId,
            operation: "product_links.update",
            contifico_id,
            medusa_id: existing[0].medusa_id,
        })
        return {
            status: "updated",
            payload: { medusa_id: existing[0].medusa_id },
        }
    }

    const [existingNew] = await service.listAndCountContificoEntityMaps({
        entity_type: "product",
        medusa_id: new_medusa_id,
    })

    if (existingNew.length > 0 && existingNew[0].contifico_id !== contifico_id) {
        return {
            status: "conflict",
            contifico_id_conflict: existingNew[0].contifico_id,
        }
    }

    await service.deleteContificoEntityMaps(existing[0].id)
    await service.createContificoEntityMaps({
        entity_type: "product",
        medusa_id: new_medusa_id,
        contifico_id,
        metadata: buildProductMapMetadata({
            ...(nextMeta || oldMeta),
            created: undefined,
            auto_linked: undefined,
            re_linked: true,
            re_linked_from: existing[0].medusa_id,
            link_origin: "relinked_to_existing",
            // Force the new Medusa product to be re-evaluated by weighted sync.
            // Carrying over sync_state from the previous mapping can make the
            // new product look already synchronized even when its current prices differ.
            sync_state: undefined,
            sync_snapshot:
                snapshotByProductId?.get(new_medusa_id) ||
                oldMeta.sync_snapshot ||
                undefined,
        }),
    })
    await cleanupRelinkedPluginCreatedProduct({
        cleanupServices,
        metadata: oldMeta,
        old_medusa_id: existing[0].medusa_id,
        new_medusa_id,
        contifico_id,
        correlationId,
    })

    logContificoEvent("info", "Product link relinked", {
        correlation_id: correlationId,
        operation: "product_links.relink",
        contifico_id,
        old_medusa_id: existing[0].medusa_id,
        new_medusa_id,
    })

    return {
        status: "relinked",
        payload: {
            old_medusa_id: existing[0].medusa_id,
            new_medusa_id,
        },
    }
}

async function cleanupRelinkedPluginCreatedProduct({
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

async function refreshRelinkedLinkedPrices({
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

export function buildMergedProductRulesOverride(
    current: ProductRulesOverride | null | undefined,
    incoming: ProductRulesOverride | null | undefined,
    weightedPriceSyncOverride: boolean | null | undefined
): ProductRulesOverride | undefined {
    const next =
        incoming === null
            ? undefined
            : mergeProductRulesOverride(current || undefined, incoming || undefined)

    if (weightedPriceSyncOverride === undefined) {
        return next
    }

    const weighted = { ...(next?.weighted || {}) }

    if (weightedPriceSyncOverride === null) {
        delete weighted.allow_weighted_price_sync
    } else {
        weighted.allow_weighted_price_sync = weightedPriceSyncOverride
    }

    return cleanupProductRulesOverride({
        ...(next || {}),
        weighted: hasKeys(weighted) ? weighted : undefined,
    })
}

function mergeProductRulesOverride(
    current?: ProductRulesOverride,
    incoming?: ProductRulesOverride
): ProductRulesOverride | undefined {
    if (!current && !incoming) {
        return undefined
    }

    return cleanupProductRulesOverride({
        pricing: mergeProductRulesSection(current?.pricing, incoming?.pricing),
        weighted: mergeProductRulesSection(current?.weighted, incoming?.weighted),
        stock: mergeProductRulesSection(current?.stock, incoming?.stock),
        invoicing: mergeProductRulesSection(current?.invoicing, incoming?.invoicing),
    })
}

function cleanupProductRulesOverride(
    value?: ProductRulesOverride
): ProductRulesOverride | undefined {
    if (!value) {
        return undefined
    }

    const next: ProductRulesOverride = {}
    for (const key of PRODUCT_RULE_OVERRIDE_SECTIONS) {
        const section = value[key]
        if (section && hasKeys(section)) {
            next[key] = section
        }
    }

    return hasKeys(next) ? next : undefined
}

function mergeProductRulesSection<TSection extends object>(
    current?: Partial<TSection> | null,
    incoming?: Partial<TSection> | null
): Partial<TSection> | undefined {
    if (incoming === null) {
        return undefined
    }

    if (!incoming) {
        return current || undefined
    }

    return {
        ...(current || {}),
        ...incoming,
    }
}

function hasKeys(value: object): boolean {
    return Object.keys(value).length > 0
}

function withProductRulesOverride(
    productRulesOverride: ProductRulesOverride | undefined
): Pick<ProductEntityMapMetadata, "product_rules_override"> {
    return {
        product_rules_override: productRulesOverride,
    }
}
