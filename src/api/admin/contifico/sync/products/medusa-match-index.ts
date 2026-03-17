import {
    getPrimaryVariantSku,
    getVariantBarcodes,
    getVariantSkus,
} from "../../../../../lib/medusa-product"
import { normalize } from "../../../../../lib/similarity"
import type { MatchCandidate } from "../../../../../lib/strategies/matching"
import type { MedusaProductRecord } from "./types"

export interface MedusaMatchIndex {
    candidatesById: Map<string, MatchCandidate>
    bySku: Map<string, MatchCandidate[]>
    byBarcode: Map<string, MatchCandidate[]>
    byExactTitleNormalized: Map<string, MatchCandidate[]>
    byTitleBucket: Map<string, MatchCandidate[]>
}

export interface MatchCandidateLookupInput {
    codigo: string
    nombre: string
    barcode?: string | null
}

export function buildMedusaMatchIndex(
    medusaProducts: MedusaProductRecord[],
    blockedProductIds: Set<string>
): MedusaMatchIndex {
    const index: MedusaMatchIndex = {
        candidatesById: new Map(),
        bySku: new Map(),
        byBarcode: new Map(),
        byExactTitleNormalized: new Map(),
        byTitleBucket: new Map(),
    }

    for (const product of medusaProducts) {
        if (blockedProductIds.has(product.id)) {
            continue
        }

        const candidate: MatchCandidate = {
            id: product.id,
            title: product.title,
            sku: getPrimaryVariantSku(product),
            skus: getVariantSkus(product),
            barcodes: getVariantBarcodes(product),
        }

        index.candidatesById.set(candidate.id, candidate)
        registerCandidate(index.byExactTitleNormalized, normalize(product.title), candidate)
        registerCandidate(index.byTitleBucket, toTitleBucket(product.title), candidate)

        for (const sku of candidate.skus) {
            registerCandidate(index.bySku, normalize(sku), candidate)
        }

        for (const barcode of candidate.barcodes) {
            registerCandidate(index.byBarcode, normalize(barcode), candidate)
        }
    }

    return index
}

export function getMatchCandidatesFromIndex(
    index: MedusaMatchIndex,
    input: MatchCandidateLookupInput
): MatchCandidate[] {
    const result = new Map<string, MatchCandidate>()
    const normalizedSku = normalize(input.codigo)
    const normalizedName = normalize(input.nombre)
    const normalizedBarcode = input.barcode ? normalize(input.barcode) : null
    const bucket = toTitleBucket(input.nombre)

    addCandidates(result, index.bySku.get(normalizedSku))
    addCandidates(result, normalizedBarcode ? index.byBarcode.get(normalizedBarcode) : null)
    addCandidates(result, index.byExactTitleNormalized.get(normalizedName))
    addCandidates(result, index.byTitleBucket.get(bucket))

    return Array.from(result.values())
}

function registerCandidate(
    store: Map<string, MatchCandidate[]>,
    key: string,
    candidate: MatchCandidate
) {
    if (!key) {
        return
    }

    const current = store.get(key)
    if (current) {
        current.push(candidate)
        return
    }

    store.set(key, [candidate])
}

function addCandidates(
    result: Map<string, MatchCandidate>,
    candidates: MatchCandidate[] | null | undefined
) {
    for (const candidate of candidates || []) {
        result.set(candidate.id, candidate)
    }
}

function toTitleBucket(value: string) {
    return normalize(value).slice(0, 12)
}
