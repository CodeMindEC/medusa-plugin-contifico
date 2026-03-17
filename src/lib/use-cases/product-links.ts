/**
 * Product links — CRUD operations and route handlers.
 *
 * Split into sub-modules:
 * - product-links-rules.ts   → ProductRulesOverride merge logic
 * - product-links-relink.ts  → Post-relink cleanup and price refresh
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type {
    IInventoryService,
    IProductModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { ProductRulesOverride } from "../advanced-settings"
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
import type { ProductInventoryQueryGraphService } from "../product-inventory-cleanup"
import { getContificoService } from "../../api/admin/contifico/shared"
import {
    buildMergedProductRulesOverride,
    withProductRulesOverride,
} from "./product-links-rules"
import {
    cleanupRelinkedPluginCreatedProduct,
    refreshRelinkedLinkedPrices,
    captureProductPriceSnapshot,
    type ProductRelinkCleanupServices,
} from "./product-links-relink"

// ── Re-exports (backward compatibility) ──────────────────
export { buildMergedProductRulesOverride } from "./product-links-rules"

// ── Types ────────────────────────────────────────────────

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
