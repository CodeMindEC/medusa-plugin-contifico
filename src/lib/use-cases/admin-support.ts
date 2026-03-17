import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type ContificoModuleService from "../../modules/contifico/service"
import { ContificoClient } from "../client"
import {
    asProductMapMetadata,
    buildProductMapMetadata,
} from "../contifico-metadata"
import {
    createCorrelationId,
    getErrorMessage,
    logContificoEvent,
} from "../observability"
import { getContificoConfig, getContificoService } from "../../api/admin/contifico/shared"

class ContificoUseCaseError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message)
    }
}

interface BodegaResponse {
    bodegas: unknown[]
    correlation_id: string
}

interface ConnectionResponse {
    ok: true
    message: string
    bodegas: number
    correlation_id: string
}

interface MigrateLinkedMetadataResponse {
    success: true
    updated: number
    skipped: number
    total: number
    errors: Array<{ id: string; error: string }>
    correlation_id: string
}

export async function listConfiguredBodegas(
    service: ContificoModuleService
): Promise<BodegaResponse> {
    const correlationId = createCorrelationId("contifico_bodegas")
    try {
        const apiKey = await getConfiguredApiKey(service)
        const client = new ContificoClient({ apiKey })
        const bodegas = await client.getAllBodegas()

        logContificoEvent("info", "Contifico bodegas fetched", {
            correlation_id: correlationId,
            operation: "config.bodegas",
            bodegas: bodegas.length,
        })

        return {
            bodegas,
            correlation_id: correlationId,
        }
    } catch (error) {
        logContificoEvent(
            "error",
            "Failed to fetch Contifico bodegas",
            {
                correlation_id: correlationId,
                operation: "config.bodegas",
            },
            error
        )
        throw error
    }
}

export async function checkContificoConnection(args: {
    service: ContificoModuleService
    apiKey?: string
}): Promise<ConnectionResponse> {
    const correlationId = createCorrelationId("contifico_check_connection")
    try {
        const apiKey = args.apiKey?.trim() || (await getConfiguredApiKey(args.service))
        const client = new ContificoClient({ apiKey, timeout: 10000, retries: 0 })
        const result = await client.testConnection()

        logContificoEvent("info", "Contifico connection succeeded", {
            correlation_id: correlationId,
            operation: "config.check_connection",
            bodegas: result.bodegas,
            used_override_key: Boolean(args.apiKey?.trim()),
        })

        return {
            ok: true,
            message: `Conexion exitosa. ${result.bodegas} bodega(s) encontrada(s).`,
            bodegas: result.bodegas,
            correlation_id: correlationId,
        }
    } catch (error) {
        logContificoEvent(
            "error",
            "Contifico connection failed",
            {
                correlation_id: correlationId,
                operation: "config.check_connection",
                used_override_key: Boolean(args.apiKey?.trim()),
            },
            error
        )
        throw error
    }
}

export async function migrateLinkedProductMetadata(
    service: ContificoModuleService
): Promise<MigrateLinkedMetadataResponse> {
    const correlationId = createCorrelationId("contifico_linked_migrate")
    try {
        const apiKey = await getConfiguredApiKey(service)
        const client = new ContificoClient({ apiKey })
        const contificoProducts = await client.getAllProductos()
        const mapByContificoId = new Map(
            contificoProducts.map((product) => [product.id, product])
        )
        const [existingMaps] = await service.listAndCountContificoEntityMaps(
            { entity_type: "product" },
            { take: 5000 }
        )

        let updatedCount = 0
        let skippedCount = 0
        const errors: Array<{ id: string; error: string }> = []

        for (const entityMap of existingMaps) {
            const contificoProduct = mapByContificoId.get(entityMap.contifico_id)
            if (!contificoProduct) {
                skippedCount++
                continue
            }

            const currentMetadata = asProductMapMetadata(entityMap.metadata)
            const hasSameName = currentMetadata.nombre === contificoProduct.nombre
            const hasSameImage =
                (currentMetadata.imagen || null) === (contificoProduct.imagen || null)

            if (hasSameName && hasSameImage) {
                skippedCount++
                continue
            }

            const nextMetadata = {
                ...currentMetadata,
                nombre: contificoProduct.nombre,
                imagen: contificoProduct.imagen || null,
                codigo: currentMetadata.codigo || contificoProduct.codigo,
            }

            try {
                await service.updateContificoEntityMaps({
                    id: entityMap.id,
                    metadata: buildProductMapMetadata(nextMetadata),
                })
                updatedCount++
            } catch (error) {
                errors.push({
                    id: entityMap.id,
                    error: getErrorMessage(error, "Error actualizando metadata"),
                })
            }
        }

        logContificoEvent("info", "Linked product metadata migration completed", {
            correlation_id: correlationId,
            operation: "products.linked.migrate",
            total: existingMaps.length,
            updated: updatedCount,
            skipped: skippedCount,
            errors: errors.length,
        })

        return {
            success: true,
            updated: updatedCount,
            skipped: skippedCount,
            total: existingMaps.length,
            errors,
            correlation_id: correlationId,
        }
    } catch (error) {
        logContificoEvent(
            "error",
            "Linked product metadata migration failed",
            {
                correlation_id: correlationId,
                operation: "products.linked.migrate",
            },
            error
        )
        throw error
    }
}

export async function runFetchContificoBodegas(
    req: MedusaRequest,
    res: MedusaResponse
) {
    const service = getContificoService(req.scope)

    try {
        const result = await listConfiguredBodegas(service)
        res.json({ bodegas: result.bodegas, correlation_id: result.correlation_id })
    } catch (error) {
        const status = error instanceof ContificoUseCaseError ? error.status : 502
        res.status(status).json({
            error:
                status === 400
                    ? getErrorMessage(error, "No hay API Key configurada.")
                    : `Error obteniendo bodegas: ${getErrorMessage(error, "Error interno")}`,
        })
    }
}

export async function runCheckContificoConnection(
    req: MedusaRequest,
    res: MedusaResponse
) {
    const service = getContificoService(req.scope)

    try {
        const result = await checkContificoConnection({
            service,
            apiKey: (req.body as { api_key?: string } | undefined)?.api_key,
        })
        res.json(result)
    } catch (error) {
        const status = error instanceof ContificoUseCaseError ? error.status : 502
        res.status(status).json({
            ok: false,
            error:
                status === 400
                    ? getErrorMessage(
                          error,
                          "No hay API Key configurada. Guarda la configuracion primero."
                      )
                    : `Error de conexion: ${getErrorMessage(error, "Error interno")}`,
        })
    }
}

export async function runMigrateLinkedProductMetadata(
    req: MedusaRequest,
    res: MedusaResponse
) {
    const service = getContificoService(req.scope)

    try {
        const result = await migrateLinkedProductMetadata(service)
        res.json(result)
    } catch (error) {
        const status = error instanceof ContificoUseCaseError ? error.status : 500
        res.status(status).json({
            error:
                status === 400
                    ? getErrorMessage(error, "No hay API Key configurada.")
                    : `Error ejecutando migración de metadata: ${getErrorMessage(error, "Error interno")}`,
        })
    }
}

async function getConfiguredApiKey(
    service: ContificoModuleService
): Promise<string> {
    const { normalized: config } = await getContificoConfig(service)

    if (!config?.api_key) {
        throw new ContificoUseCaseError("No hay API Key configurada.", 400)
    }

    return config.api_key
}
