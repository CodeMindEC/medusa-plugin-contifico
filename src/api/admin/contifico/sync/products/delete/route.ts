import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    Modules,
    ContainerRegistrationKeys,
} from "@medusajs/framework/utils"
import { CONTIFICO_MODULE } from "../../../../../../modules/contifico"
import type ContificoModuleService from "../../../../../../modules/contifico/service"

/**
 * POST /admin/contifico/sync/products/delete
 * Elimina todos los productos importados desde Contifico.
 *
 * Usa operaciones batch para máxima velocidad:
 * en vez de ~7 queries por producto (~700 para 100 prods),
 * hace ~10 queries totales sin importar la cantidad.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const started = Date.now()

    // ── Streaming NDJSON para progreso en tiempo real ───
    res.setHeader("Content-Type", "application/x-ndjson")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("X-Accel-Buffering", "no")
    res.setHeader("Connection", "keep-alive")
    res.flushHeaders()

    const sendProgress = (phase: string, message: string, percent: number) => {
        try {
            res.write(JSON.stringify({ type: "progress", phase, message, percent: Math.min(percent, 99) }) + "\n")
        } catch { /* ignore */ }
    }

    const sendResult = (data: any) => {
        try {
            res.write(JSON.stringify({ type: "result", data }) + "\n")
        } catch { /* ignore */ }
        res.end()
    }

    try {
        sendProgress("init", "Buscando productos importados...", 5)
        const contificoService: ContificoModuleService =
            req.scope.resolve(CONTIFICO_MODULE)
        const productService = req.scope.resolve(Modules.PRODUCT) as any
        const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

        // 1. Buscar entity maps de productos creados por el plugin
        const [maps] =
            await contificoService.listAndCountContificoEntityMaps(
                { entity_type: "product" },
                { take: 5000 }
            )

        const toDelete = maps.filter(
            (m: any) => m.metadata?.created === true
        )

        if (toDelete.length === 0) {
            sendResult({
                message: "No hay productos importados de Contifico para eliminar.",
                deleted: 0,
            })
            return
        }

        const total = toDelete.length
        const productIds = toDelete.map((m: any) => m.medusa_id)
        const mapIds = toDelete.map((m: any) => m.id)

        sendProgress("loading", `Cargando datos de ${total} productos...`, 10)

        // ── 2. Batch: cargar todos los productos con variantes en UNA query ──
        let allVariantIds: string[] = []
        try {
            const products = await productService.listProducts(
                { id: productIds },
                { relations: ["variants"], take: total + 100 }
            )
            allVariantIds = products.flatMap(
                (p: any) => (p.variants || []).map((v: any) => v.id)
            )
        } catch {
            // Algunos productos pueden no existir, continuar
        }

        sendProgress("loading", `${allVariantIds.length} variantes encontradas. Buscando inventario...`, 20)

        // ── 3. Batch: obtener todos los inventory links de todas las variantes ──
        const allInventoryItemIds = new Set<string>()

        if (allVariantIds.length > 0) {
            // Procesar en chunks de 100 para evitar queries demasiado grandes
            const CHUNK = 100
            for (let i = 0; i < allVariantIds.length; i += CHUNK) {
                const chunk = allVariantIds.slice(i, i + CHUNK)
                try {
                    const { data: invLinks } = await query.graph({
                        entity: "product_variant_inventory_item",
                        fields: ["inventory_item_id"],
                        filters: { variant_id: chunk },
                    })
                    for (const il of invLinks || []) {
                        if (il.inventory_item_id) {
                            allInventoryItemIds.add(il.inventory_item_id)
                        }
                    }
                } catch {
                    // ignorar
                }
            }
        }

        sendProgress("inventory", `${allInventoryItemIds.size} items de inventario. Limpiando...`, 35)

        // ── 4. Batch: eliminar inventory levels de todos los items ──
        const invItemArray = Array.from(allInventoryItemIds)
        if (invItemArray.length > 0) {
            const CHUNK = 100
            for (let i = 0; i < invItemArray.length; i += CHUNK) {
                const chunk = invItemArray.slice(i, i + CHUNK)
                try {
                    const levels = await inventoryService.listInventoryLevels(
                        { inventory_item_id: chunk },
                        { take: 5000 }
                    )
                    if (levels.length > 0) {
                        const levelIds = levels.map((lv: any) => lv.id)
                        await inventoryService.deleteInventoryLevels(levelIds)
                    }
                } catch {
                    // ignorar errores de levels
                }
            }

            sendProgress("inventory", "Eliminando items de inventario...", 50)

            // ── 5. Batch: eliminar todos los inventory items ──
            try {
                await inventoryService.deleteInventoryItems(invItemArray)
            } catch {
                // Fallback: eliminar en chunks si falla
                for (let i = 0; i < invItemArray.length; i += CHUNK) {
                    try {
                        await inventoryService.deleteInventoryItems(
                            invItemArray.slice(i, i + CHUNK)
                        )
                    } catch {
                        // ignorar
                    }
                }
            }
        }

        sendProgress("products", `Eliminando ${total} productos...`, 60)

        // ── 6. Batch: eliminar productos en chunks ──
        let deleted = 0
        let errored = 0
        const errors: Array<{ producto: string; error: string }> = []
        const PRODUCT_CHUNK = 50

        for (let i = 0; i < productIds.length; i += PRODUCT_CHUNK) {
            const chunk = productIds.slice(i, i + PRODUCT_CHUNK)
            const pct = 60 + Math.round(25 * (i / productIds.length))
            sendProgress("products", `Eliminando ${i + 1}-${Math.min(i + PRODUCT_CHUNK, total)}/${total}...`, pct)

            try {
                await productService.deleteProducts(chunk)
                deleted += chunk.length
            } catch {
                // Fallback: intentar uno por uno solo si falla el batch
                for (const pid of chunk) {
                    try {
                        await productService.deleteProducts([pid])
                        deleted++
                    } catch (err) {
                        errored++
                        errors.push({
                            producto: pid,
                            error: (err as Error).message,
                        })
                    }
                }
            }
        }

        sendProgress("cleanup", "Limpiando registros de mapeo...", 90)

        // ── 7. Batch: eliminar entity maps ──
        try {
            await contificoService.deleteContificoEntityMaps(mapIds)
        } catch {
            // Fallback: uno por uno
            for (const id of mapIds) {
                try {
                    await contificoService.deleteContificoEntityMaps(id)
                } catch {
                    // ignorar
                }
            }
        }

        const duration = Date.now() - started
        sendProgress("done", "Eliminación completada", 100)
        sendResult({
            message: `Eliminados ${deleted} productos${errored > 0 ? `, ${errored} errores` : ""}`,
            deleted,
            errors: errored,
            duration_ms: duration,
            error_details: errors.slice(0, 10),
        })
    } catch (error) {
        try {
            res.write(JSON.stringify({ type: "result", data: { error: `Error eliminando: ${(error as Error).message}` } }) + "\n")
        } catch { /* ignore */ }
        res.end()
    }
}
