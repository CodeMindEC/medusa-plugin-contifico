import { asProductMapMetadata } from "../../../../../lib/contifico-metadata"
import type {
    ContificoEntityMapRecord,
    MedusaCatalogData,
    ProductSyncContext,
} from "./types"

interface ProductEntityMapCreateInput {
    medusa_id: string
    contifico_id: string
    metadata?: Record<string, unknown> | null
}

export async function createAndCacheProductEntityMap(
    context: ProductSyncContext,
    medusaCatalog: MedusaCatalogData,
    input: ProductEntityMapCreateInput
): Promise<ContificoEntityMapRecord | null> {
    const created = await context.services.contificoService.createContificoEntityMaps({
        entity_type: "product",
        medusa_id: input.medusa_id,
        contifico_id: input.contifico_id,
        metadata: input.metadata,
    })

    const resolved =
        extractEntityMapRecord(created) ||
        (await findProductEntityMapRecord(context, input.medusa_id, input.contifico_id))

    return resolved ? cacheProductEntityMapRecord(medusaCatalog, resolved) : null
}

export async function updateAndCacheProductEntityMap(
    context: ProductSyncContext,
    medusaCatalog: MedusaCatalogData,
    input: ProductEntityMapCreateInput
): Promise<ContificoEntityMapRecord | null> {
    const cachedRecord =
        medusaCatalog.mapByContifico.get(input.contifico_id) ||
        medusaCatalog.mapByMedusa.get(input.medusa_id) ||
        null

    if (cachedRecord?.id) {
        try {
            await context.services.contificoService.updateContificoEntityMaps({
                id: cachedRecord.id,
                metadata: input.metadata,
            })
            return cacheProductEntityMapRecord(medusaCatalog, {
                ...cachedRecord,
                metadata: input.metadata,
            })
        } catch {
            // Retry below with a freshly resolved record.
        }
    }

    const persistedRecord = await findProductEntityMapRecord(
        context,
        input.medusa_id,
        input.contifico_id
    )

    if (persistedRecord?.id) {
        await context.services.contificoService.updateContificoEntityMaps({
            id: persistedRecord.id,
            metadata: input.metadata,
        })
        return cacheProductEntityMapRecord(medusaCatalog, {
            ...persistedRecord,
            metadata: input.metadata,
        })
    }

    return createAndCacheProductEntityMap(context, medusaCatalog, input)
}

async function findProductEntityMapRecord(
    context: ProductSyncContext,
    medusaId: string,
    contificoId: string
): Promise<ContificoEntityMapRecord | null> {
    const [records] = await context.services.contificoService.listAndCountContificoEntityMaps({
        entity_type: "product",
        medusa_id: medusaId,
        contifico_id: contificoId,
    })

    return records[0] || null
}

function extractEntityMapRecord(
    value: unknown
): ContificoEntityMapRecord | null {
    if (Array.isArray(value)) {
        return extractEntityMapRecord(value[0])
    }

    if (!value || typeof value !== "object") {
        return null
    }

    const record = value as Partial<ContificoEntityMapRecord>

    if (
        typeof record.id !== "string" ||
        typeof record.medusa_id !== "string" ||
        typeof record.contifico_id !== "string"
    ) {
        return null
    }

    return {
        id: record.id,
        medusa_id: record.medusa_id,
        contifico_id: record.contifico_id,
        metadata: record.metadata || null,
    }
}

function cacheProductEntityMapRecord(
    medusaCatalog: MedusaCatalogData,
    record: ContificoEntityMapRecord
): ContificoEntityMapRecord {
    const normalizedRecord = {
        id: record.id,
        medusa_id: record.medusa_id,
        contifico_id: record.contifico_id,
        metadata: asProductMapMetadata(record.metadata),
    }

    medusaCatalog.mapByMedusa.set(normalizedRecord.medusa_id, normalizedRecord)
    medusaCatalog.mapByContifico.set(
        normalizedRecord.contifico_id,
        normalizedRecord
    )

    return normalizedRecord
}
