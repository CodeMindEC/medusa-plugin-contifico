import type {
    IInventoryService,
    IProductModuleService,
} from "@medusajs/framework/types"

const INVENTORY_QUERY_BATCH_SIZE = 5
const INVENTORY_DELETE_BATCH_SIZE = 200

interface ProductVariantInventoryItemLink {
    variant_id?: string | null
    inventory_item_id?: string | null
}

interface ProductWithVariants {
    id: string
    variants?: Array<{ id?: string | null }>
}

export interface ProductInventoryQueryGraphService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

export async function loadInventoryItemIdsForProducts({
    productService,
    query,
    productIds,
}: {
    productService: Pick<IProductModuleService, "listProducts">
    query: ProductInventoryQueryGraphService
    productIds: string[]
}) {
    const inventoryItemIdsByProductId = new Map<string, string[]>()

    if (productIds.length === 0) {
        return {
            allInventoryItemIds: [] as string[],
            inventoryItemIdsByProductId,
        }
    }

    let products: ProductWithVariants[] = []
    try {
        products = await productService.listProducts(
            { id: productIds },
            { relations: ["variants"], take: productIds.length + 100 }
        )
    } catch {
        return {
            allInventoryItemIds: [] as string[],
            inventoryItemIdsByProductId,
        }
    }

    const variantToProductId = new Map<string, string>()
    const variantIds = products.flatMap((product) =>
        (product.variants || [])
            .map((variant) => {
                if (variant.id) {
                    variantToProductId.set(variant.id, product.id)
                }
                return variant.id
            })
            .filter((variantId): variantId is string => !!variantId)
    )

    if (variantIds.length === 0) {
        return {
            allInventoryItemIds: [] as string[],
            inventoryItemIdsByProductId,
        }
    }

    const allInventoryItemIds = new Set<string>()
    for (const batch of chunkArray(
        chunkArray(variantIds, 100),
        INVENTORY_QUERY_BATCH_SIZE
    )) {
        const results = await Promise.all(
            batch.map(async (variantChunk) => {
                try {
                    return await query.graph<ProductVariantInventoryItemLink>({
                        entity: "product_variant_inventory_item",
                        fields: ["variant_id", "inventory_item_id"],
                        filters: { variant_id: variantChunk },
                    })
                } catch {
                    return { data: [] as ProductVariantInventoryItemLink[] }
                }
            })
        )

        for (const result of results) {
            for (const link of result.data || []) {
                if (!link.inventory_item_id) {
                    continue
                }

                allInventoryItemIds.add(link.inventory_item_id)
                const productId = link.variant_id
                    ? variantToProductId.get(link.variant_id)
                    : null

                if (!productId) {
                    continue
                }

                const existingIds = inventoryItemIdsByProductId.get(productId) || []
                if (!existingIds.includes(link.inventory_item_id)) {
                    existingIds.push(link.inventory_item_id)
                    inventoryItemIdsByProductId.set(productId, existingIds)
                }
            }
        }
    }

    return {
        allInventoryItemIds: Array.from(allInventoryItemIds),
        inventoryItemIdsByProductId,
    }
}

export async function deleteInventoryLevelsForItems(
    inventoryService: Pick<IInventoryService, "listInventoryLevels" | "deleteInventoryLevels">,
    inventoryItemIds: string[]
) {
    const uniqueItemIds = Array.from(new Set(inventoryItemIds))
    if (uniqueItemIds.length === 0) {
        return
    }

    const levelIds: string[] = []
    for (const batch of chunkArray(
        chunkArray(uniqueItemIds, 100),
        INVENTORY_QUERY_BATCH_SIZE
    )) {
        const levelsBatch = await Promise.all(
            batch.map(async (inventoryItemChunk) => {
                try {
                    return await inventoryService.listInventoryLevels(
                        { inventory_item_id: inventoryItemChunk },
                        { take: 5000 }
                    )
                } catch {
                    return []
                }
            })
        )

        for (const levels of levelsBatch) {
            levelIds.push(...levels.map((level) => level.id))
        }
    }

    for (const batch of chunkArray(levelIds, INVENTORY_DELETE_BATCH_SIZE)) {
        if (batch.length === 0) {
            continue
        }

        try {
            await inventoryService.deleteInventoryLevels(batch)
        } catch {
        }
    }
}

export async function deleteInventoryItemsAfterProductCleanup(
    inventoryService: Pick<IInventoryService, "deleteInventoryItems">,
    inventoryItemIds: string[]
) {
    const errors: Array<{ producto: string; error: string }> = []

    for (const chunk of chunkArray(Array.from(new Set(inventoryItemIds)), 100)) {
        try {
            await inventoryService.deleteInventoryItems(chunk)
        } catch {
            for (const inventoryItemId of chunk) {
                try {
                    await inventoryService.deleteInventoryItems([inventoryItemId])
                } catch (error) {
                    errors.push({
                        producto: inventoryItemId,
                        error:
                            error instanceof Error
                                ? error.message
                                : "Error eliminando inventory item",
                    })
                }
            }
        }
    }

    return errors
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
    const chunks: T[][] = []
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize))
    }
    return chunks
}
