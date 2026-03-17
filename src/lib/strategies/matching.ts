import type { MatchPriority, MatchingAdvancedSettings, StrategyDecision } from "../advanced-settings"
import { normalize, productSimilarity } from "../similarity"

export interface MatchCandidate {
    id: string
    title: string
    sku: string | null
    skus: string[]
    barcodes: string[]
}

export interface MatchInput {
    contifico_id: string
    contifico_codigo: string
    contifico_nombre: string
    contifico_barcode?: string | null
    candidates: MatchCandidate[]
    threshold: number
    settings: MatchingAdvancedSettings
}

export interface MatchResult {
    candidate: MatchCandidate | null
    match_type: "exact_sku" | "barcode" | "exact_name" | "similar" | null
    similarity: number
    decisions: Array<StrategyDecision<unknown>>
    blocked: boolean
}

export function resolveMatch(input: MatchInput): MatchResult {
    const decisions: Array<StrategyDecision<unknown>> = []
    const contificoSku = normalize(input.contifico_codigo)
    const contificoBarcode = input.contifico_barcode ? normalize(input.contifico_barcode) : null

    for (const priority of input.settings.priority) {
        const result = matchByPriority(priority, input, contificoSku, contificoBarcode)
        decisions.push({
            strategy: `matching:${priority}`,
            value: result.candidate?.id || null,
            reason: result.reason,
            warnings: result.warning ? [result.warning] : undefined,
        })
        if (result.blocked) {
            return {
                candidate: null,
                match_type: null,
                similarity: 0,
                decisions,
                blocked: true,
            }
        }
        if (result.candidate) {
            return {
                candidate: result.candidate,
                match_type: result.match_type,
                similarity: result.similarity,
                decisions,
                blocked: false,
            }
        }
    }

    return {
        candidate: null,
        match_type: null,
        similarity: 0,
        decisions,
        blocked: false,
    }
}

function matchByPriority(
    priority: MatchPriority,
    input: MatchInput,
    contificoSku: string,
    contificoBarcode: string | null
): {
    candidate: MatchCandidate | null
    match_type: MatchResult["match_type"]
    similarity: number
    reason: string
    blocked?: boolean
    warning?: string
} {
    switch (priority) {
        case "sku": {
            const matches = input.candidates.filter((candidate) =>
                candidate.skus.some((sku) => normalize(sku) === contificoSku)
            )
            return resolveCandidateList(matches, "exact_sku", 1, "SKU exacto", input.settings)
        }
        case "barcode": {
            if (!contificoBarcode) {
                return {
                    candidate: null,
                    match_type: null,
                    similarity: 0,
                    reason: "Sin código de barras en Contífico",
                }
            }
            const matches = input.candidates.filter((candidate) =>
                candidate.barcodes.some((barcode) => normalize(barcode) === contificoBarcode)
            )
            return resolveCandidateList(matches, "barcode", 1, "Código de barras exacto", input.settings)
        }
        case "exact_name": {
            const matches = input.candidates.filter(
                (candidate) => normalize(candidate.title) === normalize(input.contifico_nombre)
            )
            return resolveCandidateList(matches, "exact_name", 1, "Nombre exacto", input.settings)
        }
        case "similar_name": {
            let best: MatchCandidate | null = null
            let bestScore = 0
            for (const candidate of input.candidates) {
                const score = productSimilarity(input.contifico_nombre, candidate.title)
                if (score >= input.threshold && score > bestScore) {
                    best = candidate
                    bestScore = score
                }
            }
            return {
                candidate: best,
                match_type: best ? "similar" : null,
                similarity: bestScore,
                reason: best
                    ? `Mejor similitud ${bestScore.toFixed(2)}`
                    : `Sin similitud >= ${input.threshold}`,
            }
        }
    }
}

function resolveCandidateList(
    matches: MatchCandidate[],
    match_type: MatchResult["match_type"],
    similarity: number,
    reason: string,
    settings: MatchingAdvancedSettings
): {
    candidate: MatchCandidate | null
    match_type: MatchResult["match_type"]
    similarity: number
    reason: string
    blocked?: boolean
    warning?: string
} {
    if (matches.length === 0) {
        return { candidate: null, match_type: null, similarity: 0, reason: `Sin match: ${reason}` }
    }

    if (matches.length > 1 && settings.exclude_if_multiple_candidates) {
        return {
            candidate: null,
            match_type: null,
            similarity: 0,
            reason: `${reason}: múltiples candidatos`,
            blocked: true,
            warning: "Se excluyó por múltiples candidatos",
        }
    }

    return {
        candidate: matches[0],
        match_type,
        similarity,
        reason,
    }
}
