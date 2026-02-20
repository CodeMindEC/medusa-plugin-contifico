import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IProductModuleService } from "@medusajs/framework/types"
import {
    Modules,
    ContainerRegistrationKeys,
    ProductStatus,
} from "@medusajs/framework/utils"
import { CONTIFICO_MODULE } from "../../../../../modules/contifico"
import type ContificoModuleService from "../../../../../modules/contifico/service"
import { ContificoClient } from "../../../../../lib/client"
import { normalize, productSimilarity } from "../../../../../lib/similarity"
import { fromCSV } from "../../../../../lib/csv"
import type { ContificoProducto, ContificoVariante } from "../../../../../lib/types/common"

const toHandle = (name: string): string =>
    name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

/**
 * POST /admin/contifico/sync/products
 * Sincroniza productos y stock desde Contifico → Medusa.
 * Usa operaciones en batch para máxima velocidad.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const started = Date.now()
    let totalCreated = 0
    let totalErrors = 0
    let totalStockUpdated = 0
    let totalAutoLinked = 0
    let totalImages = 0
    let totalVariants = 0
    const errors: Array<{ producto: string; error: string }> = []

    // ── Streaming NDJSON para progreso en tiempo real ───
    res.setHeader("Content-Type", "application/x-ndjson")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("X-Accel-Buffering", "no")
    res.setHeader("Connection", "keep-alive")
    res.flushHeaders()

    const sendProgress = (phase: string, message: string, percent: number) => {
        try {
            res.write(JSON.stringify({ type: "progress", phase, message, percent: Math.min(percent, 99) }) + "\n")
        } catch { /* ignore write errors */ }
    }

    const sendResult = (data: any) => {
        try {
            res.write(JSON.stringify({ type: "result", data }) + "\n")
        } catch { /* ignore */ }
        res.end()
    }

    const sendError = (error: string) => {
        try {
            res.write(JSON.stringify({ type: "result", data: { error } }) + "\n")
        } catch { /* ignore */ }
        res.end()
    }

    try {
        sendProgress("init", "Inicializando servicios...", 2)

        // ── Servicios ──────────────────────────────────────
        const contificoService: ContificoModuleService =
            req.scope.resolve(CONTIFICO_MODULE)
        const productService: IProductModuleService =
            req.scope.resolve(Modules.PRODUCT)
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
        const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
        const stockLocationService = req.scope.resolve(
            Modules.STOCK_LOCATION
        ) as any
        const fulfillmentModule = req.scope.resolve(Modules.FULFILLMENT) as any
        const salesChannelModule = req.scope.resolve(
            Modules.SALES_CHANNEL
        ) as any
        const storeModule = req.scope.resolve(Modules.STORE) as any
        const pricingService = req.scope.resolve(Modules.PRICING) as any
        const link = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

        const [configs] = await contificoService.listAndCountContificoConfigs()
        const config = configs[0]

        if (!config?.api_key) {
            sendError("No hay API Key configurada.")
            return
        }

        const bodegaIds = fromCSV(config.bodega_ids)
        const shouldManageInventory = config.manage_inventory ?? false
        const shouldAllowBackorder = config.allow_backorder ?? false
        const variantMode = config.variant_mode || "auto"
        const client = new ContificoClient({ apiKey: config.api_key })

        // ── Shipping profile y sales channel ───────────────
        let shippingProfileId: string | null = config.shipping_profile_id || null
        if (!shippingProfileId) {
            const shippingProfiles = await fulfillmentModule.listShippingProfiles({
                type: "default",
            })
            shippingProfileId = shippingProfiles[0]?.id || null
        }

        let salesChannelId: string | null = config.sales_channel_id || null
        if (!salesChannelId) {
            const salesChannels = await salesChannelModule.listSalesChannels({
                name: "Default Sales Channel",
            })
            salesChannelId = salesChannels[0]?.id || null
            if (!salesChannelId) {
                const [store] = await storeModule.listStores()
                if (store?.default_sales_channel_id) {
                    salesChannelId = store.default_sales_channel_id
                }
            }
        }

        sendProgress("locations", "Configurando ubicaciones de stock...", 5)

        // ── 1. Stock locations para cada bodega ────────────
        const contificoBodegas = await client.getAllBodegas()
        const bodegaMap = new Map(contificoBodegas.map((b) => [b.id, b]))

        const existingLocations =
            await stockLocationService.listStockLocations({}, { take: 1000 })

        const bodegaToLocation = new Map<string, string>()

        for (const bodegaId of bodegaIds) {
            const bodega = bodegaMap.get(bodegaId)
            const bodegaNombre = bodega?.nombre || `Bodega ${bodegaId}`

            let existing = existingLocations.find(
                (loc: any) =>
                    loc.metadata?.contifico_bodega_id === bodegaId ||
                    loc.name === bodegaNombre
            )
            if (!existing) {
                existing = await stockLocationService.createStockLocations({
                    name: bodegaNombre,
                    metadata: {
                        contifico_bodega_id: bodegaId,
                        source: "contifico-plugin",
                    },
                })
            }
            bodegaToLocation.set(bodegaId, existing.id)
        }

        let primaryLocationId: string | null = null
        const primaryLoc = existingLocations.find(
            (loc: any) => loc.metadata?.contifico_primary === true
        )
        if (primaryLoc) {
            primaryLocationId = primaryLoc.id
        } else if (existingLocations.length > 0) {
            primaryLocationId = existingLocations[0].id
        } else if (bodegaToLocation.size > 0) {
            primaryLocationId = Array.from(bodegaToLocation.values())[0]
        }

        sendProgress("loading", "Descargando productos de Contifico...", 10)

        // ── 2. Traer datos de Contifico ────────────────────
        const contificoProducts = await client.getAllProductos()
        const activeProducts = contificoProducts.filter(
            (p) => p.estado === "A"
        )

        sendProgress("loading", `${activeProducts.length} productos activos encontrados. Cargando variantes...`, 15)

        // Cargar variantes de Contifico (v1, 1 sola request)
        let contificoVariantes: ContificoVariante[] = []
        const varianteMap = new Map<string, ContificoVariante>()
        try {
            contificoVariantes = await client.getVariantes()
            for (const v of contificoVariantes) {
                varianteMap.set(v.id, v)
            }
        } catch {
            // Si falla, seguimos sin variantes
        }

        sendProgress("loading", `Variantes cargadas (${contificoVariantes.length}). Leyendo datos de Medusa...`, 20)

        // ── 3. Mapeos existentes ───────────────────────────
        const [existingMaps] =
            await contificoService.listAndCountContificoEntityMaps({
                entity_type: "product",
            })
        const mapByContifico = new Map(
            existingMaps.map((m) => [m.contifico_id, m])
        )
        const mapByMedusa = new Map(
            existingMaps.map((m) => [m.medusa_id, m])
        )

        sendProgress("medusa", "Cargando productos existentes de Medusa...", 25)

        // ── 4. Productos de Medusa para auto-match ─────────
        const medusaProducts = await productService.listProducts(
            {},
            { take: 5000, relations: ["variants"] }
        )

        const medusaBySku = new Map<string, (typeof medusaProducts)[0]>()
        for (const mp of medusaProducts) {
            for (const v of mp.variants || []) {
                if ((v as any).sku) {
                    medusaBySku.set(normalize((v as any).sku), mp)
                }
            }
        }

        sendProgress("medusa", `${medusaProducts.length} productos en Medusa. Cargando inventario...`, 28)

        // ── 5. Inventory items por SKU ─────────────────────
        const inventoryItemsBySku = new Map<
            string,
            { id: string; sku: string }
        >()
        try {
            const { data: iItems } = await query.graph({
                entity: "inventory_item",
                fields: ["id", "sku"],
            })
            for (const ii of iItems) {
                if (ii.sku) {
                    inventoryItemsBySku.set(normalize(ii.sku), ii)
                }
            }
        } catch {
            // Sin inventory items
        }

        // ── 6. Inventory levels existentes ─────────────────
        const existingLevels = new Map<string, string>()
        try {
            const allLocationIds = [
                ...Array.from(bodegaToLocation.values()),
                ...(primaryLocationId ? [primaryLocationId] : []),
            ]
            for (const locId of [...new Set(allLocationIds)]) {
                const levels = await inventoryService.listInventoryLevels({
                    location_id: locId,
                })
                for (const lv of levels) {
                    existingLevels.set(
                        `${lv.inventory_item_id}:${locId}`,
                        lv.id
                    )
                }
            }
        } catch {
            // Sin levels
        }

        sendProgress("classify", `Clasificando ${activeProducts.length} productos...`, 35)

        // ── 7. Clasificar: vincular vs crear ───────────────
        const usedHandles = new Set(
            medusaProducts.map((p) => p.handle).filter(Boolean)
        )

        const linkedProducts: Array<{
            cp: ContificoProducto
            medusaId: string
        }> = []
        const toCreate: ContificoProducto[] = []

        for (const cp of activeProducts) {
            try {
                let medusaId: string | null = null
                const map = mapByContifico.get(cp.id)

                if (map) {
                    medusaId = map.medusa_id
                } else {
                    const codigoNorm = normalize(cp.codigo)
                    const skuMatch = medusaBySku.get(codigoNorm)

                    if (skuMatch && !mapByMedusa.has(skuMatch.id)) {
                        medusaId = skuMatch.id
                        await contificoService.createContificoEntityMaps({
                            entity_type: "product",
                            medusa_id: medusaId,
                            contifico_id: cp.id,
                            metadata: {
                                codigo: cp.codigo,
                                auto_linked: true,
                                match_type: "sku",
                            },
                        })
                        mapByMedusa.set(medusaId, {
                            medusa_id: medusaId,
                        } as any)
                        totalAutoLinked++
                    } else {
                        let bestScore = 0
                        let bestMedusa: (typeof medusaProducts)[0] | null =
                            null
                        for (const mp of medusaProducts) {
                            if (mapByMedusa.has(mp.id)) continue
                            const score = productSimilarity(
                                cp.nombre,
                                mp.title
                            )
                            if (score >= 0.8 && score > bestScore) {
                                bestScore = score
                                bestMedusa = mp
                            }
                        }
                        if (bestMedusa) {
                            medusaId = bestMedusa.id
                            await contificoService.createContificoEntityMaps({
                                entity_type: "product",
                                medusa_id: medusaId,
                                contifico_id: cp.id,
                                metadata: {
                                    codigo: cp.codigo,
                                    auto_linked: true,
                                    match_type: "name",
                                    similarity: bestScore,
                                },
                            })
                            mapByMedusa.set(medusaId, {
                                medusa_id: medusaId,
                            } as any)
                            totalAutoLinked++
                        }
                    }
                }

                if (medusaId) {
                    linkedProducts.push({ cp, medusaId })
                } else {
                    toCreate.push(cp)
                }
            } catch (err) {
                errors.push({
                    producto: cp.nombre || cp.codigo,
                    error: (err as Error).message,
                })
                totalErrors++
            }
        }

        sendProgress("classify", `${toCreate.length} por crear, ${linkedProducts.length} vinculados`, 40)

        // ── 8. BATCH: Crear productos en Medusa ────────────
        // Helper: construir URL proxy para imágenes de Contifico
        // Contifico envía Content-Disposition: attachment y Content-Type incorrecto,
        // el proxy /admin/contifico/media re-sirve con headers correctos.
        const getImageUrl = (imageUrl: string): string => {
            const baseUrl = `${req.protocol}://${req.get("host")}`
            return `${baseUrl}/admin/contifico/media?url=${encodeURIComponent(imageUrl)}`
        }

        // Helper: construir variantes y opciones por producto
        const buildVariants = (cp: ContificoProducto) => {
            const detalle = cp.detalle_variantes || []
            const pvps = [cp.pvp1, cp.pvp2, cp.pvp3, cp.pvp4].filter(
                (p): p is string => p != null && p !== ""
            )

            // Modo "simple": siempre variante única con pvp1
            // Modo "contifico": solo variantes oficiales, fallback a variante única
            // Modo "auto": usa variantes oficiales si existen, sino variante única
            const useContificoVariants =
                variantMode === "simple" ? false :
                    variantMode === "contifico" ? true :
                        detalle.length > 0 // auto

            if (useContificoVariants && detalle.length > 0) {
                const options: Record<string, string[]> = {}
                const optionOrder: string[] = []

                for (const dv of detalle) {
                    const variante = varianteMap.get(dv.variante_id)
                    if (!variante) continue

                    if (!options[variante.nombre]) {
                        options[variante.nombre] = []
                        optionOrder.push(variante.nombre)
                    }

                    if (dv.valor_id) {
                        const val = variante.valores?.find(
                            (v) => v.id === dv.valor_id
                        )
                        if (val) {
                            options[variante.nombre].push(val.valor)
                        }
                    } else {
                        // valor_id null: agregar todos los valores
                        for (const val of variante.valores || []) {
                            if (!options[variante.nombre].includes(val.valor)) {
                                options[variante.nombre].push(val.valor)
                            }
                        }
                    }
                }

                // Generar combinaciones de opciones
                const optionNames = optionOrder.filter(
                    (n) => options[n]?.length > 0
                )
                if (optionNames.length > 0) {
                    const combinations: Record<string, string>[] = []
                    const generateCombinations = (
                        idx: number,
                        current: Record<string, string>
                    ) => {
                        if (idx >= optionNames.length) {
                            combinations.push({ ...current })
                            return
                        }
                        const name = optionNames[idx]
                        for (const val of options[name]) {
                            current[name] = val
                            generateCombinations(idx + 1, current)
                        }
                    }
                    generateCombinations(0, {})

                    if (combinations.length > 0) {
                        return combinations.map((opts, idx) => {
                            const title = Object.values(opts).join(" / ")
                            return {
                                title,
                                sku: combinations.length === 1
                                    ? cp.codigo
                                    : `${cp.codigo}-${idx + 1}`,
                                manage_inventory: shouldManageInventory,
                                allow_backorder: shouldAllowBackorder,
                                options: opts,
                            }
                        })
                    }
                }
            }

            // Sin variantes de Contifico → variante única
            return [
                {
                    title: cp.nombre,
                    sku: cp.codigo,
                    manage_inventory: shouldManageInventory,
                    allow_backorder: shouldAllowBackorder,
                },
            ]
        }

        if (toCreate.length > 0) {
            const BATCH_SIZE = 20

            for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
                const batchEnd = Math.min(i + BATCH_SIZE, toCreate.length)
                const pctBase = 42
                const pctRange = 38 // 42% → 80%
                const pct = pctBase + Math.round(pctRange * (i / toCreate.length))
                sendProgress("create", `Creando productos ${i + 1}-${batchEnd} de ${toCreate.length} (descargando imágenes)...`, pct)

                const batch = toCreate.slice(i, i + BATCH_SIZE)

                // Preparar inputs con imágenes descargadas a S3
                const productInputs: any[] = []
                for (const cp of batch) {
                    let handle = toHandle(cp.nombre)
                    if (usedHandles.has(handle)) {
                        handle = `${handle}-${cp.codigo.toLowerCase().replace(/[^a-z0-9-]/g, "")}`
                    }
                    usedHandles.add(handle)

                    const variants = buildVariants(cp)

                    // Imagen: usar proxy que re-sirve con headers correctos
                    let thumbnail: string | undefined
                    let images: Array<{ url: string }> | undefined
                    if (cp.imagen && cp.imagen.startsWith("http")) {
                        const imgUrl = getImageUrl(cp.imagen)
                        thumbnail = imgUrl
                        images = [{ url: imgUrl }]
                    }

                    productInputs.push({
                        title: cp.nombre,
                        handle,
                        description: cp.descripcion || undefined,
                        status: ProductStatus.PUBLISHED,
                        thumbnail,
                        images,
                        variants,
                        metadata: {
                            contifico_id: cp.id,
                            contifico_codigo: cp.codigo,
                            marca: cp.marca_nombre || null,
                            porcentaje_iva: cp.porcentaje_iva ?? null,
                            codigo_barra: cp.codigo_barra || null,
                        },
                    })
                }

                try {
                    // Batch crear productos
                    const createdProducts =
                        await productService.createProducts(
                            productInputs as any
                        )
                    const products = Array.isArray(createdProducts)
                        ? createdProducts
                        : [createdProducts]

                    // Preparar datos para links batch
                    // Ahora un producto puede tener N variantes → N price sets
                    const variantMeta: Array<{
                        product: any
                        variantId: string
                        variantSku: string
                        cp: ContificoProducto
                        priceIdx: number // índice de la variante dentro del producto
                    }> = []

                    for (let j = 0; j < products.length; j++) {
                        const product = products[j]
                        const cp = batch[j]
                        const pvps = [cp.pvp1, cp.pvp2, cp.pvp3, cp.pvp4].filter(
                            (p): p is string => p != null && p !== ""
                        )

                        const productVariants = product.variants || []
                        if (productVariants.length === 0) {
                            errors.push({
                                producto: cp.nombre,
                                error: "Producto creado sin variante",
                            })
                            totalErrors++
                            continue
                        }

                        for (
                            let v = 0;
                            v < productVariants.length;
                            v++
                        ) {
                            variantMeta.push({
                                product,
                                variantId: productVariants[v].id,
                                variantSku:
                                    productVariants[v].sku || cp.codigo,
                                cp,
                                priceIdx: v,
                            })
                        }
                    }

                    if (variantMeta.length === 0) continue

                    // Price sets: un precio por variante
                    const priceSetsInput = variantMeta.map((vm) => {
                        const pvps = [
                            vm.cp.pvp1,
                            vm.cp.pvp2,
                            vm.cp.pvp3,
                            vm.cp.pvp4,
                        ].filter(
                            (p): p is string => p != null && p !== ""
                        )
                        // Asignar pvp por índice, fallback a pvp1
                        const pvp = pvps[vm.priceIdx] || pvps[0] || "0"
                        return {
                            prices: [
                                {
                                    amount: parseFloat(pvp),
                                    currency_code: "usd",
                                },
                            ],
                        }
                    })

                    // Inventory items: uno por variante
                    const invItemsInput = variantMeta.map((vm) => ({
                        sku: vm.variantSku,
                        title: vm.cp.nombre,
                    }))

                    // Batch crear price sets e inventory items en paralelo
                    const [priceSets, invItems] = await Promise.all([
                        pricingService.createPriceSets(priceSetsInput),
                        inventoryService.createInventoryItems(invItemsInput),
                    ])

                    const psList = Array.isArray(priceSets)
                        ? priceSets
                        : [priceSets]
                    const iiList = Array.isArray(invItems)
                        ? invItems
                        : [invItems]

                    // Crear todos los links
                    const allLinks: any[] = []
                    const seenProductIds = new Set<string>()

                    for (let j = 0; j < variantMeta.length; j++) {
                        const { product, variantId, variantSku, cp } =
                            variantMeta[j]

                        // Links de producto (solo una vez por producto)
                        if (!seenProductIds.has(product.id)) {
                            seenProductIds.add(product.id)

                            if (shippingProfileId) {
                                allLinks.push({
                                    [Modules.PRODUCT]: {
                                        product_id: product.id,
                                    },
                                    [Modules.FULFILLMENT]: {
                                        shipping_profile_id: shippingProfileId,
                                    },
                                })
                            }

                            if (salesChannelId) {
                                allLinks.push({
                                    [Modules.PRODUCT]: {
                                        product_id: product.id,
                                    },
                                    [Modules.SALES_CHANNEL]: {
                                        sales_channel_id: salesChannelId,
                                    },
                                })
                            }
                        }

                        // Links de variante (pricing + inventory)
                        if (psList[j]) {
                            allLinks.push({
                                [Modules.PRODUCT]: {
                                    variant_id: variantId,
                                },
                                [Modules.PRICING]: {
                                    price_set_id: psList[j].id,
                                },
                            })
                        }

                        if (iiList[j]) {
                            allLinks.push({
                                [Modules.PRODUCT]: {
                                    variant_id: variantId,
                                },
                                [Modules.INVENTORY]: {
                                    inventory_item_id: iiList[j].id,
                                },
                            })
                            inventoryItemsBySku.set(
                                normalize(variantSku),
                                iiList[j]
                            )
                        }
                    }

                    // Links en paralelo (de a 30)
                    for (let l = 0; l < allLinks.length; l += 30) {
                        await Promise.all(
                            allLinks
                                .slice(l, l + 30)
                                .map((lk) => link.create(lk))
                        )
                    }

                    // Entity maps en batch (una vez por producto)
                    const processedProducts = new Set<string>()
                    const entityMapInputs: any[] = []
                    for (const { product, cp } of variantMeta) {
                        if (processedProducts.has(product.id)) continue
                        processedProducts.add(product.id)
                        entityMapInputs.push({
                            entity_type: "product",
                            medusa_id: product.id,
                            contifico_id: cp.id,
                            metadata: { codigo: cp.codigo, created: true },
                        })
                        linkedProducts.push({ cp, medusaId: product.id })
                        totalCreated++
                        if (cp.imagen && cp.imagen.startsWith("http")) totalImages++
                        totalVariants += (product.variants?.length || 1)
                    }
                    // Crear todos los entity maps en paralelo
                    await Promise.all(
                        entityMapInputs.map((input) =>
                            contificoService.createContificoEntityMaps(input)
                        )
                    )
                } catch (batchErr) {
                    for (const cp of batch) {
                        errors.push({
                            producto: cp.nombre,
                            error: `Crear: ${(batchErr as Error).message}`,
                        })
                        totalErrors++
                    }
                }
            }
        }

        // ── 9. Actualizar stock (híbrido: por bodega si coincide, fallback a cantidad_stock) ──
        // Optimizado: pre-carga stock de Contifico en paralelo (lotes de 10)
        sendProgress("stock", `Actualizando stock de ${linkedProducts.length} productos...`, 80)
        const stockWarnings: Array<{
            producto: string
            codigo: string
            cantidad_stock: number
            suma_bodegas: number
            bodegas_detalle: Array<{
                nombre: string
                cantidad: number
            }>
            accion: string
        }> = []

        if (primaryLocationId) {
            const levelsToCreate: Array<{
                inventory_item_id: string
                location_id: string
                stocked_quantity: number
            }> = []
            const levelsToUpdate: Array<{
                id: string
                stocked_quantity: number
            }> = []

            // ── Pre-cargar stock de Contifico en paralelo ──
            // En vez de 1 request secuencial por producto, hacemos lotes de 10 en paralelo
            const stockCache = new Map<string, Array<{
                bodega_id: string
                bodega_nombre: string
                cantidad: number
            }>>()

            if (bodegaIds.length > 0) {
                const STOCK_BATCH = 10
                const productsWithInventory = linkedProducts.filter(({ cp }) => {
                    const codigoNorm = normalize(cp.codigo)
                    return inventoryItemsBySku.has(codigoNorm)
                })

                for (let i = 0; i < productsWithInventory.length; i += STOCK_BATCH) {
                    const batch = productsWithInventory.slice(i, i + STOCK_BATCH)
                    if (i % 20 === 0) {
                        sendProgress("stock", `Descargando stock ${i + 1}/${productsWithInventory.length}...`, 80 + Math.round(7 * (i / productsWithInventory.length)))
                    }

                    const results = await Promise.allSettled(
                        batch.map(({ cp }) =>
                            client.getStockAll(cp.id).then(data => ({ id: cp.id, data }))
                        )
                    )

                    for (const result of results) {
                        if (result.status === "fulfilled") {
                            stockCache.set(
                                result.value.id,
                                result.value.data.map(s => ({
                                    bodega_id: s.bodega_id,
                                    bodega_nombre: s.bodega_nombre,
                                    cantidad: Math.max(0, Math.floor(
                                        typeof s.cantidad === "string"
                                            ? parseFloat(s.cantidad)
                                            : s.cantidad
                                    )),
                                }))
                            )
                        }
                    }
                }
            }

            sendProgress("stock", "Procesando niveles de inventario...", 87)

            // ── Procesar stock usando cache ──
            for (let si = 0; si < linkedProducts.length; si++) {
                const { cp } = linkedProducts[si]
                const codigoNorm = normalize(cp.codigo)
                const iItem = inventoryItemsBySku.get(codigoNorm)
                if (!iItem) continue

                const cantidadStockTotal = Math.max(
                    0,
                    Math.floor(parseFloat(cp.cantidad_stock ?? "0"))
                )

                const bodegaStocks = stockCache.get(cp.id) || []
                const stockEndpointOk = stockCache.has(cp.id)
                const sumaBodegas = bodegaStocks.reduce((acc, s) => acc + s.cantidad, 0)

                const coincide =
                    stockEndpointOk && sumaBodegas === cantidadStockTotal

                if (coincide && bodegaStocks.length > 0) {
                    // ✅ Coinciden — distribuir por bodega
                    for (const bs of bodegaStocks) {
                        const locId = bodegaToLocation.get(bs.bodega_id)
                        if (!locId) continue

                        const key = `${iItem.id}:${locId}`
                        const levelId = existingLevels.get(key)
                        if (levelId) {
                            levelsToUpdate.push({
                                id: levelId,
                                stocked_quantity: bs.cantidad,
                            })
                        } else {
                            levelsToCreate.push({
                                inventory_item_id: iItem.id,
                                location_id: locId,
                                stocked_quantity: bs.cantidad,
                            })
                        }
                    }
                } else {
                    // ⚠ No coincide o endpoint falló — usar cantidad_stock en primary
                    const primaryKey = `${iItem.id}:${primaryLocationId}`
                    const primaryLevelId = existingLevels.get(primaryKey)
                    if (primaryLevelId) {
                        levelsToUpdate.push({
                            id: primaryLevelId,
                            stocked_quantity: cantidadStockTotal,
                        })
                    } else {
                        levelsToCreate.push({
                            inventory_item_id: iItem.id,
                            location_id: primaryLocationId,
                            stocked_quantity: cantidadStockTotal,
                        })
                    }

                    // Poner 0 en las bodegas secundarias para no duplicar
                    for (const [bId, locId] of bodegaToLocation.entries()) {
                        if (locId === primaryLocationId) continue
                        const key = `${iItem.id}:${locId}`
                        const levelId = existingLevels.get(key)
                        if (levelId) {
                            levelsToUpdate.push({
                                id: levelId,
                                stocked_quantity: 0,
                            })
                        }
                    }

                    if (
                        stockEndpointOk &&
                        sumaBodegas !== cantidadStockTotal
                    ) {
                        stockWarnings.push({
                            producto: cp.nombre,
                            codigo: cp.codigo,
                            cantidad_stock: cantidadStockTotal,
                            suma_bodegas: sumaBodegas,
                            bodegas_detalle: bodegaStocks.map((s) => ({
                                nombre: s.bodega_nombre,
                                cantidad: s.cantidad,
                            })),
                            accion: `Stock total (${cantidadStockTotal}) asignado a ubicación principal`,
                        })
                    }
                }

                totalStockUpdated++
            }

            sendProgress("stock", "Guardando niveles de inventario...", 91)

            // Batch crear levels nuevos
            if (levelsToCreate.length > 0) {
                for (let i = 0; i < levelsToCreate.length; i += 50) {
                    const batch = levelsToCreate.slice(i, i + 50)
                    try {
                        await inventoryService.createInventoryLevels(batch)
                    } catch {
                        for (const lv of batch) {
                            try {
                                await inventoryService.createInventoryLevels(lv)
                            } catch {
                                // ignorar duplicados
                            }
                        }
                    }
                }
            }

            // Batch actualizar levels existentes
            if (levelsToUpdate.length > 0) {
                for (let i = 0; i < levelsToUpdate.length; i += 50) {
                    const batch = levelsToUpdate.slice(i, i + 50)
                    await Promise.all(
                        batch.map((lv) =>
                            inventoryService.updateInventoryLevels(lv.id, {
                                stocked_quantity: lv.stocked_quantity,
                            })
                        )
                    )
                }
            }
        }

        sendProgress("saving", "Guardando resultados...", 95)

        // ── 10. Actualizar last_product_sync ───────────────
        await contificoService.updateContificoConfigs({
            id: config.id,
            last_product_sync: new Date().toISOString(),
        })

        // ── 11. Registrar log ──────────────────────────────
        const duration = Date.now() - started
        const locationsCreated = Array.from(bodegaToLocation.entries()).map(
            ([bId, locId]) => ({
                bodega_id: bId,
                bodega_nombre: bodegaMap.get(bId)?.nombre || bId,
                stock_location_id: locId,
            })
        )

        const totalActualizadosYCreados =
            totalCreated + totalAutoLinked + totalStockUpdated

        await contificoService.createContificoSyncLogs({
            sync_type: "products",
            status: totalErrors > 0 ? "partial" : "success",
            total_processed: totalActualizadosYCreados,
            total_errors: totalErrors,
            duration_ms: duration,
            started_at: new Date(started).toISOString(),
            details: {
                trigger: "manual",
                contifico_total: contificoProducts.length,
                active_products: activeProducts.length,
                created: totalCreated,
                auto_linked: totalAutoLinked,
                stock_updated: totalStockUpdated,
                medusa_products: medusaProducts.length,
                inventory_items: inventoryItemsBySku.size,
                locations: locationsCreated,
                stock_warnings: stockWarnings.length,
                errors: errors.slice(0, 20),
            },
        })

        const msg = [
            totalCreated > 0 ? `${totalCreated} creados` : null,
            totalAutoLinked > 0 ? `${totalAutoLinked} vinculados` : null,
            totalStockUpdated > 0
                ? `${totalStockUpdated} stock actualizado`
                : null,
            stockWarnings.length > 0
                ? `${stockWarnings.length} stock con mismatch (usó cantidad_stock)`
                : null,
            totalErrors > 0 ? `${totalErrors} errores` : null,
        ]
            .filter(Boolean)
            .join(", ")

        sendProgress("done", "Sincronización completada", 100)

        sendResult({
            message: `Sync completado: ${msg || "sin cambios"}`,
            stats: {
                created: totalCreated,
                auto_linked: totalAutoLinked,
                stock_updated: totalStockUpdated,
                variants_created: totalVariants,
                images_set: totalImages,
                processed: totalActualizadosYCreados,
                errors: totalErrors,
                duration_ms: duration,
            },
            errors: errors.slice(0, 10),
            stock_warnings: stockWarnings.slice(0, 20),
        })
    } catch (error) {
        const duration = Date.now() - started
        try {
            const service: ContificoModuleService =
                req.scope.resolve(CONTIFICO_MODULE)
            await service.createContificoSyncLogs({
                sync_type: "products",
                status: "error",
                total_processed: 0,
                total_errors: totalErrors + 1,
                duration_ms: duration,
                started_at: new Date(started).toISOString(),
                details: {
                    trigger: "manual",
                    fatal: (error as Error).message,
                },
            })
        } catch {
            // noop
        }

        sendError(`Error en sync: ${(error as Error).message}`)
    }
}
