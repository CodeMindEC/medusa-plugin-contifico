import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ContificoClient } from "../../../../../lib/client"
import { asProductMapMetadata } from "../../../../../lib/contifico-metadata"
import { createNdjsonStream } from "../../../../../lib/ndjson"
import { normalizeProductSyncState } from "../../../../../lib/product-sync-state"
import { applyImportFilters } from "../../../../../lib/product-filter"
import { normalize } from "../../../../../lib/similarity"
import { getContificoConfig, getContificoService } from "../../shared"
import { buildMedusaMatchIndex } from "./medusa-match-index"
import type {
    InventoryItemRecord,
    InventoryLevelRecord,
    MedusaCatalogData,
    MedusaProductRecord,
    ProductCatalogData,
    ProductSyncContext,
    ProductSyncResult,
    ProductSyncServices,
    QueryGraphService,
    SalesChannelRecord,
    ShippingProfileRecord,
    StockLocationRecord,
    StoreRecord,
} from "./types"

const MEDUSA_PRODUCTS_PAGE_SIZE = 250

interface ResolverScope {
    resolve: (key: string) => unknown
}

interface LoadProductSyncContextOptions {
    scope: ResolverScope
    stream: ProductSyncContext["stream"]
    req?: MedusaRequest | null
    request_base_url?: string | null
}

export function resolveProductSyncServices(scope: ResolverScope): ProductSyncServices {
    return {
        contificoService: getContificoService(scope),
        productService: scope.resolve(Modules.PRODUCT) as ProductSyncServices["productService"],
        query: scope.resolve(ContainerRegistrationKeys.QUERY) as ProductSyncServices["query"],
        inventoryService: scope.resolve(Modules.INVENTORY) as ProductSyncServices["inventoryService"],
        stockLocationService:
            scope.resolve(Modules.STOCK_LOCATION) as ProductSyncServices["stockLocationService"],
        fulfillmentModule:
            scope.resolve(Modules.FULFILLMENT) as ProductSyncServices["fulfillmentModule"],
        salesChannelModule:
            scope.resolve(Modules.SALES_CHANNEL) as ProductSyncServices["salesChannelModule"],
        storeModule: scope.resolve(Modules.STORE) as ProductSyncServices["storeModule"],
        pricingService: scope.resolve(Modules.PRICING) as ProductSyncServices["pricingService"],
        link: scope.resolve(ContainerRegistrationKeys.LINK) as ProductSyncServices["link"],
    }
}

export async function loadProductSyncContext(
    req: MedusaRequest,
    res: MedusaResponse
): Promise<ProductSyncContext | null> {
    const stream = createNdjsonStream<ProductSyncResult>(res)
    return loadProductSyncContextFromScope({
        scope: req.scope,
        stream,
        req,
        request_base_url: `${req.protocol}://${req.get("host")}`,
    })
}

export async function loadProductSyncContextFromScope({
    scope,
    stream,
    req,
    request_base_url,
}: LoadProductSyncContextOptions): Promise<ProductSyncContext | null> {
    stream.progress("init", "Inicializando servicios...", 2)

    const services = resolveProductSyncServices(scope)
    const { normalized: config } = await getContificoConfig(services.contificoService)

    if (!config?.api_key) {
        stream.error("No hay API Key configurada.")
        return null
    }

    const client = new ContificoClient({ apiKey: config.api_key })
    let shippingProfileId = config.shipping_profile_id || null
    if (!shippingProfileId) {
        const shippingProfiles = (await services.fulfillmentModule.listShippingProfiles({
            type: "default",
        })) as ShippingProfileRecord[]
        shippingProfileId = shippingProfiles[0]?.id || null
    }

    let salesChannelId = config.sales_channel_id || null
    if (!salesChannelId) {
        const salesChannels = (await services.salesChannelModule.listSalesChannels({
            name: "Default Sales Channel",
        })) as SalesChannelRecord[]
        salesChannelId = salesChannels[0]?.id || null
        if (!salesChannelId) {
            const [store] = (await services.storeModule.listStores()) as StoreRecord[]
            salesChannelId = store?.default_sales_channel_id || null
        }
    }

    stream.progress("locations", "Configurando ubicaciones de stock...", 5)
    const contificoBodegas = await client.getAllBodegas()
    const bodegaMap = new Map(contificoBodegas.map((bodega) => [bodega.id, bodega]))
    const existingLocations = (await services.stockLocationService.listStockLocations(
        {},
        { take: 1000 }
    )) as StockLocationRecord[]

    const bodegaToLocation = new Map<string, string>()
    for (const bodegaId of config.bodega_ids) {
        const bodega = bodegaMap.get(bodegaId)
        const bodegaNombre = bodega?.nombre || `Bodega ${bodegaId}`

        let location = existingLocations.find(
            (item) =>
                item.metadata?.contifico_bodega_id === bodegaId ||
                item.name === bodegaNombre
        )

        if (!location) {
            location = (await services.stockLocationService.createStockLocations({
                name: bodegaNombre,
                metadata: {
                    contifico_bodega_id: bodegaId,
                    source: "contifico-plugin",
                },
            })) as StockLocationRecord
        }

        bodegaToLocation.set(bodegaId, location.id)
    }

    const primaryLocationId =
        existingLocations.find((item) => item.metadata?.contifico_primary === true)?.id ||
        existingLocations[0]?.id ||
        Array.from(bodegaToLocation.values())[0] ||
        null

    return {
        req,
        stream,
        services,
        config,
        clientApiKey: config.api_key,
        request_base_url: request_base_url || null,
        bodegaIds: config.bodega_ids,
        shouldManageInventory: config.manage_inventory ?? false,
        shouldAllowBackorder: config.allow_backorder ?? false,
        variantMode: config.variant_mode,
        shippingProfileId,
        salesChannelId,
        contificoBodegas,
        bodegaMap,
        bodegaToLocation,
        primaryLocationId,
    }
}

export async function loadContificoCatalog(
    context: ProductSyncContext
): Promise<ProductCatalogData> {
    const client = new ContificoClient({ apiKey: context.clientApiKey })
    context.stream.progress("loading", "Descargando productos de Contifico...", 10)

    const contificoProducts = await client.getAllProductos()
    let activeProducts = contificoProducts.filter((product) => product.estado === "A")

    if (context.config.import_filters?.rules.length) {
        const beforeCount = activeProducts.length
        activeProducts = applyImportFilters(activeProducts, context.config.import_filters)
        const filtered = beforeCount - activeProducts.length
        if (filtered > 0) {
            context.stream.progress(
                "filter",
                `Filtros aplicados: ${filtered} producto(s) excluidos por reglas de importacion`,
                12
            )
        }
    }

    context.stream.progress(
        "loading",
        `${activeProducts.length} productos activos encontrados. Cargando variantes...`,
        15
    )

    const varianteMap = new Map()
    try {
        const variantes = await client.getVariantes()
        for (const variante of variantes) {
            varianteMap.set(variante.id, variante)
        }
        context.stream.progress(
            "loading",
            `Variantes cargadas (${variantes.length}). Leyendo datos de Medusa...`,
            20
        )
    } catch {
        context.stream.progress(
            "loading",
            "Variantes no disponibles. Leyendo datos de Medusa...",
            20
        )
    }

    return {
        contificoProducts,
        activeProducts,
        varianteMap,
    }
}

export async function loadMedusaCatalog(
    context: ProductSyncContext
): Promise<MedusaCatalogData> {
    const { productService } = context.services
    const mapsData = await loadProductEntityMaps(context)

    context.stream.progress("medusa", "Cargando productos existentes de Medusa...", 25)
    const medusaProducts = await listAllMedusaProducts(productService)

    const medusaBySku = new Map<string, MedusaProductRecord>()
    const medusaById = new Map<string, MedusaProductRecord>()
    for (const product of medusaProducts) {
        medusaById.set(product.id, product)
        for (const variant of product.variants || []) {
            if (variant.sku) {
                medusaBySku.set(normalize(variant.sku), product)
            }
        }
    }

    context.stream.progress(
        "medusa",
        `${medusaProducts.length} productos en Medusa.`,
        28
    )

    return {
        ...mapsData,
        medusaProducts,
        medusaById,
        medusaBySku,
        matchIndex: buildMedusaMatchIndex(
            medusaProducts,
            new Set(mapsData.existingMaps.map((item) => item.medusa_id))
        ),
        inventoryItemsBySku: new Map(),
        existingLevels: new Map(),
    }
}

export async function loadProductEntityMaps(
    context: Pick<ProductSyncContext, "services">
): Promise<Pick<MedusaCatalogData, "existingMaps" | "mapByContifico" | "mapByMedusa">> {
    const [existingMapsRaw] =
        await context.services.contificoService.listAndCountContificoEntityMaps({
            entity_type: "product",
        })
    const existingMaps = existingMapsRaw
        .map((item) => ({
            ...item,
            metadata: asProductMapMetadata(item.metadata),
        }))
        .filter(
            (item) =>
                normalizeProductSyncState(item.metadata?.sync_state)?.cleanup_state !==
                "pending"
        ) as MedusaCatalogData["existingMaps"]

    return {
        existingMaps,
        mapByContifico: new Map(existingMaps.map((item) => [item.contifico_id, item])),
        mapByMedusa: new Map(existingMaps.map((item) => [item.medusa_id, item])),
    }
}

export async function loadMedusaInventorySnapshot(
    context: ProductSyncContext,
    relevantSkus: string[],
    locationIds: string[]
): Promise<{
    inventoryItemsBySku: Map<string, { id: string; sku: string }>
    existingLevels: Map<string, string>
}> {
    const inventoryItemsBySku = await loadInventoryItemsBySku(
        context.services.query,
        relevantSkus
    )
    const existingLevels = await loadInventoryLevelsByLocation(
        context.services.inventoryService,
        Array.from(inventoryItemsBySku.values()).map((item) => item.id),
        locationIds
    )

    return {
        inventoryItemsBySku,
        existingLevels,
    }
}

async function listAllMedusaProducts(
    productService: ProductSyncServices["productService"]
): Promise<MedusaProductRecord[]> {
    const products: MedusaProductRecord[] = []

    for (let offset = 0; ; offset += MEDUSA_PRODUCTS_PAGE_SIZE) {
        const page = (await productService.listProducts(
            {},
            {
                take: MEDUSA_PRODUCTS_PAGE_SIZE,
                skip: offset,
                relations: ["variants"],
            }
        )) as MedusaProductRecord[]

        products.push(...page)
        if (page.length < MEDUSA_PRODUCTS_PAGE_SIZE) {
            break
        }
    }

    return products
}

async function loadInventoryItemsBySku(
    query: QueryGraphService,
    relevantSkus: string[]
) {
    const inventoryItemsBySku = new Map<string, { id: string; sku: string }>()
    const filteredSkus = Array.from(
        new Set(relevantSkus.map((sku) => sku?.trim()).filter((sku): sku is string => !!sku))
    )

    if (filteredSkus.length === 0) {
        return inventoryItemsBySku
    }

    try {
        const { data } = await query.graph<InventoryItemRecord>({
            entity: "inventory_item",
            fields: ["id", "sku"],
            filters: { sku: filteredSkus },
        })

        for (const item of data) {
            if (item.sku) {
                inventoryItemsBySku.set(normalize(item.sku), {
                    id: item.id,
                    sku: item.sku,
                })
            }
        }

        return inventoryItemsBySku
    } catch {
        const { data } = await query.graph<InventoryItemRecord>({
            entity: "inventory_item",
            fields: ["id", "sku"],
        })

        for (const item of data) {
            if (item.sku) {
                const normalizedSku = normalize(item.sku)
                if (filteredSkus.includes(item.sku) || filteredSkus.includes(normalizedSku)) {
                    inventoryItemsBySku.set(normalizedSku, {
                        id: item.id,
                        sku: item.sku,
                    })
                }
            }
        }

        return inventoryItemsBySku
    }
}

async function loadInventoryLevelsByLocation(
    inventoryService: ProductSyncServices["inventoryService"],
    inventoryItemIds: string[],
    locationIds: string[]
) {
    const existingLevels = new Map<string, string>()
    const uniqueLocationIds = Array.from(new Set(locationIds.filter(Boolean)))
    const uniqueInventoryItemIds = Array.from(
        new Set(inventoryItemIds.filter(Boolean))
    )

    if (uniqueLocationIds.length === 0 || uniqueInventoryItemIds.length === 0) {
        return existingLevels
    }

    for (const locationId of uniqueLocationIds) {
        for (let index = 0; index < uniqueInventoryItemIds.length; index += 200) {
            const chunk = uniqueInventoryItemIds.slice(index, index + 200)
            const levels = (await inventoryService.listInventoryLevels(
                {
                    inventory_item_id: chunk,
                    location_id: locationId,
                },
                { take: 5000 }
            )) as InventoryLevelRecord[]

            for (const level of levels) {
                existingLevels.set(`${level.inventory_item_id}:${locationId}`, level.id)
            }
        }
    }

    return existingLevels
}
