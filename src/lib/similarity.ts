/**
 * Utilidades de similitud de strings para matching de productos.
 *
 * Usa coeficiente de Dice (bigram similarity) + bonus por coincidencia
 * exacta de tokens. Funciona bien para nombres de productos con
 * variaciones de orden, acentos, y abreviaciones.
 */

/** Normaliza un string: minúsculas, sin acentos, sin caracteres especiales */
export function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // quitar acentos
        .replace(/[^a-z0-9\s]/g, " ") // solo alfanuméricos y espacios
        .replace(/\s+/g, " ")
        .trim()
}

/** Genera bigramas de un string */
function bigrams(s: string): string[] {
    const result: string[] = []
    for (let i = 0; i < s.length - 1; i++) {
        result.push(s.slice(i, i + 2))
    }
    return result
}

/**
 * Coeficiente de Dice: 2 * |intersección| / (|A| + |B|)
 * Rango: 0 (nada) a 1 (idéntico)
 */
function diceCoefficient(a: string, b: string): number {
    const na = normalize(a)
    const nb = normalize(b)

    if (na === nb) return 1
    if (na.length < 2 || nb.length < 2) return 0

    const bigramsA = bigrams(na)
    const bigramsB = bigrams(nb)

    const setB = new Map<string, number>()
    for (const bg of bigramsB) {
        setB.set(bg, (setB.get(bg) || 0) + 1)
    }

    let matches = 0
    for (const bg of bigramsA) {
        const count = setB.get(bg)
        if (count && count > 0) {
            matches++
            setB.set(bg, count - 1)
        }
    }

    return (2 * matches) / (bigramsA.length + bigramsB.length)
}

/**
 * Bonus por tokens compartidos: cuántas "palabras" del nombre coinciden.
 * Útil para "ACEITE GIRASOL 1L" vs "ACEITE DE GIRASOL 1 LITRO"
 */
function tokenOverlap(a: string, b: string): number {
    const tokensA = new Set(normalize(a).split(" ").filter((t) => t.length > 1))
    const tokensB = new Set(normalize(b).split(" ").filter((t) => t.length > 1))

    if (tokensA.size === 0 || tokensB.size === 0) return 0

    let shared = 0
    for (const t of tokensA) {
        if (tokensB.has(t)) shared++
    }

    // Jaccard-like: shared / total unique tokens
    return shared / Math.max(tokensA.size, tokensB.size)
}

/**
 * Score compuesto de similitud entre dos nombres de productos.
 * Combina Dice (forma del texto) + tokens (palabras compartidas).
 * Rango: 0 a 1
 */
export function productSimilarity(a: string, b: string): number {
    const dice = diceCoefficient(a, b)
    const tokens = tokenOverlap(a, b)

    // 60% Dice + 40% token overlap
    return dice * 0.6 + tokens * 0.4
}

/** Umbral mínimo para considerar un match como "sugerido" */
export const SIMILARITY_THRESHOLD = 0.45

export interface ProductMatch {
    contifico_id: string
    contifico_nombre: string
    contifico_codigo: string
    contifico_imagen?: string | null
    medusa_id: string
    medusa_title: string
    medusa_sku: string | null
    similarity: number
    match_type: "exact_sku" | "exact_name" | "similar" | "barcode"
}
