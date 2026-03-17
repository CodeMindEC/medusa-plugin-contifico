import { Modules, ProductStatus } from "@medusajs/framework/utils"
import type {
    CreateProductDTO,
    CreateProductVariantDTO,
} from "@medusajs/framework/types"
import {
    CONTIFICO_WEIGHT_METADATA_KEY,
    asPositiveNumber,
    calculateWeightedVariantPrice,
} from "../../../../../lib/contifico-weighted"
import { normalize } from "../../../../../lib/similarity"
import {
    buildWeightedPresentationVariantLabel,
    buildWeightedPresentationVariantSku,
    resolveWeightedPresentationProfile,
    type WeightedPresentationProfile,
    type WeightedPresentationProfileVariant,
} from "../../../../../lib/weighted-presentation-profiles"
import type {
    ContificoProducto,
    ContificoVariante,
} from "../../../../../lib/types"
import type {
    CreatedMedusaProduct,
    InventoryItemSummary,
    ProductSyncContext,
} from "./types"

export interface VariantResourcePlan {
    sku: string
    pvp_field: "pvp1" | "pvp2" | "pvp3" | "pvp4"
    weight_grams?: number | null
}

export interface ProductResourcePlan {
    profile_id?: string | null
    variants: VariantResourcePlan[]
}

export interface BuiltProductInput {
    input: CreateProductDTO
    resources: ProductResourcePlan
}

export const CONTIFICO_VARIANT_PVP_FIELD_METADATA_KEY = "contifico_pvp_field"

export function buildProductInput(
    context: ProductSyncContext,
    varianteMap: Map<string, ContificoVariante>,
    product: ContificoProducto,
    usedHandles: Set<string>
): BuiltProductInput {
    let handle = toHandle(product.nombre)
    if (usedHandles.has(handle)) {
        handle = `${handle}-${product.codigo.toLowerCase().replace(/[^a-z0-9-]/g, "")}`
    }
    usedHandles.add(handle)

    const imageUrl =
        product.imagen?.startsWith("http")
            ? buildMediaProxyUrl(context, product.imagen)
            : null
    const weightedProfile =
        context.variantMode === "weighted"
            ? resolveWeightedPresentationProfile(product, {
                  creation_mode:
                      context.config.advanced_settings.weighted.creation_mode,
                  default_profile_id:
                      context.config.advanced_settings.weighted.default_profile_id,
                  creation_profiles:
                      context.config.advanced_settings.weighted.creation_profiles,
              }).profile
            : null
    const builtVariants = buildVariants(
        context,
        varianteMap,
        product,
        weightedProfile
    )
    const weightedPresentationOptions =
        weightedProfile && weightedProfile.variants.length > 1
            ? [
                  {
                      title: "Presentacion",
                      values: weightedProfile.variants.map((variant) =>
                          buildWeightedPresentationVariantLabel(variant)
                      ),
                  },
              ]
            : undefined

    return {
        input: {
            title: product.nombre,
            handle,
            description: product.descripcion || undefined,
            status: ProductStatus.PUBLISHED,
            thumbnail: imageUrl || undefined,
            images: imageUrl ? [{ url: imageUrl }] : undefined,
            options: weightedPresentationOptions,
            variants: builtVariants.variants,
            metadata: {
                contifico_id: product.id,
                contifico_codigo: product.codigo,
                marca: product.marca_nombre || null,
                porcentaje_iva: product.porcentaje_iva ?? null,
                codigo_barra: product.codigo_barra || null,
            },
        },
        resources: {
            profile_id: weightedProfile?.id || null,
            variants: builtVariants.resources,
        },
    }
}

function buildMediaProxyUrl(
    context: Pick<ProductSyncContext, "request_base_url" | "req">,
    imageUrl: string
) {
    const baseUrl =
        context.request_base_url ||
        (context.req
            ? `${context.req.protocol}://${context.req.get("host")}`
            : null)

    return baseUrl
        ? `${baseUrl}/admin/contifico/media?url=${encodeURIComponent(imageUrl)}`
        : imageUrl
}

export async function attachVariantResources(
    context: ProductSyncContext,
    sourceProducts: ContificoProducto[],
    createdProducts: CreatedMedusaProduct[],
    inventoryItemsBySku: Map<string, InventoryItemSummary>,
    resourcePlans: ProductResourcePlan[]
) {
    const variantMeta: Array<{
        product: CreatedMedusaProduct
        source: ContificoProducto
        variantId: string
        variantSku: string
        pvpField: "pvp1" | "pvp2" | "pvp3" | "pvp4"
        weightGrams: number | null
    }> = []

    for (let index = 0; index < createdProducts.length; index++) {
        const created = createdProducts[index]
        const source = sourceProducts[index]
        const resourcePlan = resourcePlans[index]

        if (!created.variants?.length) {
            continue
        }

        for (let variantIndex = 0; variantIndex < created.variants.length; variantIndex++) {
            const variant = created.variants[variantIndex]
            const resourceVariant = resourcePlan?.variants[variantIndex] || {
                sku: variant.sku || source.codigo,
                pvp_field: resolveVariantPvpFieldByIndex(variantIndex),
            }
            variantMeta.push({
                product: created,
                source,
                variantId: variant.id || "",
                variantSku: resourceVariant.sku || variant.sku || source.codigo,
                pvpField: resourceVariant.pvp_field,
                weightGrams: resourceVariant.weight_grams ?? variant.weight ?? null,
            })
        }
    }

    if (variantMeta.length === 0) {
        return
    }

    const priceSets = await context.services.pricingService.createPriceSets(
        variantMeta.map(({ source, pvpField, weightGrams }) => {
            return {
                prices: [
                    {
                        amount: resolveVariantPriceAmount(
                            source,
                            pvpField,
                            weightGrams
                        ),
                        currency_code: "usd",
                    },
                ],
            }
        })
    )

    const inventoryItems = await context.services.inventoryService.createInventoryItems(
        variantMeta.map(({ variantSku, source }) => ({
            sku: variantSku,
            title: source.nombre,
        }))
    )

    const priceSetList = Array.isArray(priceSets) ? priceSets : [priceSets]
    const inventoryItemList = Array.isArray(inventoryItems)
        ? inventoryItems
        : [inventoryItems]
    const links: Array<Record<string, unknown>> = []
    const linkedProducts = new Set<string>()

    for (let index = 0; index < variantMeta.length; index++) {
        const item = variantMeta[index]
        const priceSet = priceSetList[index]
        const inventoryItem = inventoryItemList[index]

        if (!linkedProducts.has(item.product.id)) {
            linkedProducts.add(item.product.id)
            if (context.shippingProfileId) {
                links.push({
                    [Modules.PRODUCT]: { product_id: item.product.id },
                    [Modules.FULFILLMENT]: {
                        shipping_profile_id: context.shippingProfileId,
                    },
                })
            }

            if (context.salesChannelId) {
                links.push({
                    [Modules.PRODUCT]: { product_id: item.product.id },
                    [Modules.SALES_CHANNEL]: {
                        sales_channel_id: context.salesChannelId,
                    },
                })
            }
        }

        if (priceSet?.id) {
            links.push({
                [Modules.PRODUCT]: { variant_id: item.variantId },
                [Modules.PRICING]: { price_set_id: priceSet.id },
            })
        }

        if (inventoryItem?.id) {
            links.push({
                [Modules.PRODUCT]: { variant_id: item.variantId },
                [Modules.INVENTORY]: { inventory_item_id: inventoryItem.id },
            })
            inventoryItemsBySku.set(normalize(item.variantSku), {
                id: inventoryItem.id,
                sku: inventoryItem.sku || item.variantSku,
            })
        }
    }

    for (let index = 0; index < links.length; index += 30) {
        await Promise.all(
            links
                .slice(index, index + 30)
                .map((link) => context.services.link.create(link))
        )
    }
}

function buildVariants(
    context: ProductSyncContext,
    varianteMap: Map<string, ContificoVariante>,
    product: ContificoProducto,
    weightedProfile?: WeightedPresentationProfile | null
): {
    variants: CreateProductVariantDTO[]
    resources: VariantResourcePlan[]
} {
    if (context.variantMode === "weighted" && weightedProfile) {
        return buildWeightedPresentationVariants(context, product, weightedProfile)
    }

    const detail = product.detalle_variantes || []
    const useContificoVariants =
        context.variantMode === "simple"
            ? false
            : context.variantMode === "contifico"
              ? true
              : detail.length > 0

    if (useContificoVariants && detail.length > 0) {
        const optionValues: Record<string, string[]> = {}
        const optionOrder: string[] = []

        for (const variantDetail of detail) {
            const variant = varianteMap.get(variantDetail.variante_id)
            if (!variant) {
                continue
            }

            if (!optionValues[variant.nombre]) {
                optionValues[variant.nombre] = []
                optionOrder.push(variant.nombre)
            }

            if (variantDetail.valor_id) {
                const value = variant.valores?.find(
                    (item) => item.id === variantDetail.valor_id
                )
                if (value?.valor && !optionValues[variant.nombre].includes(value.valor)) {
                    optionValues[variant.nombre].push(value.valor)
                }
            } else {
                for (const value of variant.valores || []) {
                    if (!optionValues[variant.nombre].includes(value.valor)) {
                        optionValues[variant.nombre].push(value.valor)
                    }
                }
            }
        }

        const optionNames = optionOrder.filter((name) => optionValues[name]?.length > 0)
        if (optionNames.length > 0) {
            const combinations = buildVariantCombinations(optionNames, optionValues)
            if (combinations.length > 0) {
                return {
                    variants: combinations.map((options, index) => ({
                        title: Object.values(options).join(" / "),
                        sku:
                            combinations.length === 1
                                ? product.codigo
                                : `${product.codigo}-${index + 1}`,
                        manage_inventory: context.shouldManageInventory,
                        allow_backorder: context.shouldAllowBackorder,
                        options,
                        metadata: {
                            [CONTIFICO_VARIANT_PVP_FIELD_METADATA_KEY]:
                                resolveVariantPvpFieldByIndex(index),
                        },
                    })),
                    resources: combinations.map((options, index) => ({
                        sku:
                            combinations.length === 1
                                ? product.codigo
                                : `${product.codigo}-${index + 1}`,
                        pvp_field: resolveVariantPvpFieldByIndex(index),
                    })),
                }
            }
        }
    }

    return {
        variants: [
            {
                title: product.nombre,
                sku: product.codigo,
                manage_inventory: context.shouldManageInventory,
                allow_backorder: context.shouldAllowBackorder,
                metadata: {
                    [CONTIFICO_VARIANT_PVP_FIELD_METADATA_KEY]: "pvp1",
                },
            },
        ],
        resources: [
            {
                sku: product.codigo,
                pvp_field: "pvp1",
            },
        ],
    }
}

function buildWeightedPresentationVariants(
    context: ProductSyncContext,
    product: ContificoProducto,
    profile: WeightedPresentationProfile
): {
    variants: CreateProductVariantDTO[]
    resources: VariantResourcePlan[]
} {
    const variants = profile.variants.map((variant) =>
        buildWeightedVariantInput(context, product, variant, profile.variants.length)
    )

    return {
        variants: variants.map((item) => item.input),
        resources: variants.map((item) => item.resource),
    }
}

function buildWeightedVariantInput(
    context: ProductSyncContext,
    product: ContificoProducto,
    variant: WeightedPresentationProfileVariant,
    variantCount: number
): {
    input: CreateProductVariantDTO
    resource: VariantResourcePlan
} {
    const label = buildWeightedPresentationVariantLabel(variant)
    const sku = buildWeightedPresentationVariantSku(product.codigo, variant)

    return {
        input: {
            title: label,
            sku,
            manage_inventory: context.shouldManageInventory,
            allow_backorder: context.shouldAllowBackorder,
            weight: variant.grams,
            metadata: {
                [CONTIFICO_WEIGHT_METADATA_KEY]: variant.grams,
                contifico_weighted_pvp_field: variant.pvp_field,
            },
            ...(variantCount > 1
                ? {
                      options: {
                          Presentacion: label,
                      },
                  }
                : {}),
        },
        resource: {
            sku,
            pvp_field: variant.pvp_field,
            weight_grams: variant.grams,
        },
    }
}

function buildVariantCombinations(
    optionNames: string[],
    optionValues: Record<string, string[]>
): Array<Record<string, string>> {
    const combinations: Array<Record<string, string>> = []

    const build = (index: number, current: Record<string, string>) => {
        if (index >= optionNames.length) {
            combinations.push({ ...current })
            return
        }

        const optionName = optionNames[index]
        for (const value of optionValues[optionName]) {
            current[optionName] = value
            build(index + 1, current)
        }
    }

    build(0, {})
    return combinations
}

export function resolveVariantPvpFieldByIndex(
    index: number
): "pvp1" | "pvp2" | "pvp3" | "pvp4" {
    switch (index) {
        case 1:
            return "pvp2"
        case 2:
            return "pvp3"
        case 3:
            return "pvp4"
        default:
            return "pvp1"
    }
}

function selectProductPvpField(
    product: Pick<ContificoProducto, "pvp1" | "pvp2" | "pvp3" | "pvp4">,
    field: "pvp1" | "pvp2" | "pvp3" | "pvp4"
): string | null {
    const selected = product[field]
    if (typeof selected === "string" && selected.trim() !== "") {
        return selected
    }

    return asPositiveNumber(product.pvp1) != null ? product.pvp1 || null : null
}

export function resolveVariantPriceAmount(
    product: Pick<ContificoProducto, "pvp1" | "pvp2" | "pvp3" | "pvp4">,
    field: "pvp1" | "pvp2" | "pvp3" | "pvp4",
    weightGrams?: number | null
): number {
    const selected = selectProductPvpField(product, field) || "0"
    const baseAmount = parseFloat(selected)

    if (weightGrams != null && weightGrams > 0) {
        return calculateWeightedVariantPrice(weightGrams, baseAmount)
    }

    return baseAmount
}

function toHandle(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
}
