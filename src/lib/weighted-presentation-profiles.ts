import type { StrategyDecision } from "./advanced-settings-contracts"
import type { WeightedPvpField } from "./contifico-config"
import type { ContificoProducto } from "./types"

export const WEIGHTED_CREATION_MODE_VALUES = [
    "manual_only",
    "presentation_profile",
] as const

export type WeightedCreationMode = (typeof WEIGHTED_CREATION_MODE_VALUES)[number]

export interface WeightedPresentationProfileVariant {
    grams: number
    pvp_field: WeightedPvpField
    label?: string | null
    sku_suffix?: string | null
}

export interface WeightedPresentationProfileMatcher {
    category_ids?: string[]
    brand_ids?: string[]
    unit_ids?: string[]
    code_prefixes?: string[]
}

export interface WeightedPresentationProfile {
    id: string
    name: string
    matcher?: WeightedPresentationProfileMatcher | null
    variants: WeightedPresentationProfileVariant[]
}

export interface WeightedCreationSettings {
    creation_mode: WeightedCreationMode
    default_profile_id?: string | null
    creation_profiles: WeightedPresentationProfile[]
}

export interface WeightedProfileResolution {
    profile: WeightedPresentationProfile | null
    decision: StrategyDecision<string | null>
    warnings: string[]
}

export function isWeightedCreationMode(value: unknown): value is WeightedCreationMode {
    return WEIGHTED_CREATION_MODE_VALUES.includes(value as WeightedCreationMode)
}

export function normalizeWeightedCreationMode(
    value: unknown,
    fallback: WeightedCreationMode = "manual_only"
): WeightedCreationMode {
    return isWeightedCreationMode(value) ? value : fallback
}

export function normalizeWeightedPresentationProfiles(
    value: unknown
): WeightedPresentationProfile[] {
    if (!Array.isArray(value)) {
        return []
    }

    const profiles = value
        .map((item, index) => normalizeWeightedPresentationProfile(item, index))
        .filter((item): item is WeightedPresentationProfile => !!item)

    const deduped = new Map<string, WeightedPresentationProfile>()
    for (const profile of profiles) {
        deduped.set(profile.id, profile)
    }

    return Array.from(deduped.values())
}

export function resolveWeightedPresentationProfile(
    product: Pick<ContificoProducto, "codigo" | "categoria_id" | "marca_id" | "unidad">,
    settings: WeightedCreationSettings
): WeightedProfileResolution {
    if (settings.creation_mode !== "presentation_profile") {
        return {
            profile: null,
            decision: {
                strategy: "weighted_creation:mode",
                value: null,
                reason: "La creación automática weighted está desactivada; se requiere vinculación manual.",
            },
            warnings: [],
        }
    }

    const profiles = normalizeWeightedPresentationProfiles(settings.creation_profiles)
    if (profiles.length === 0) {
        return {
            profile: null,
            decision: {
                strategy: "weighted_creation:profile",
                value: null,
                reason: "No hay perfiles de presentación configurados para auto-crear productos weighted.",
            },
            warnings: [],
        }
    }

    const matchedProfiles = profiles.filter((profile) =>
        weightedPresentationProfileMatchesProduct(profile, product)
    )

    if (matchedProfiles.length === 1) {
        return {
            profile: matchedProfiles[0],
            decision: {
                strategy: "weighted_creation:profile",
                value: matchedProfiles[0].id,
                reason: `Perfil seleccionado por reglas: ${matchedProfiles[0].name}`,
            },
            warnings: [],
        }
    }

    if (matchedProfiles.length > 1) {
        return {
            profile: null,
            decision: {
                strategy: "weighted_creation:profile",
                value: null,
                reason: `Se encontraron ${matchedProfiles.length} perfiles aplicables; la creación automática se bloqueó para evitar ambigüedad.`,
            },
            warnings: matchedProfiles.map(
                (profile) => `Perfil coincidente: ${profile.name} (${profile.id})`
            ),
        }
    }

    const defaultProfile = getWeightedPresentationProfileById(
        profiles,
        settings.default_profile_id
    )
    if (defaultProfile) {
        return {
            profile: defaultProfile,
            decision: {
                strategy: "weighted_creation:profile",
                value: defaultProfile.id,
                reason: `Sin coincidencia específica; se usa el perfil por defecto ${defaultProfile.name}.`,
            },
            warnings: [],
        }
    }

    if (profiles.length === 1 && !hasWeightedPresentationMatcher(profiles[0].matcher)) {
        return {
            profile: profiles[0],
            decision: {
                strategy: "weighted_creation:profile",
                value: profiles[0].id,
                reason: `Se usa el único perfil configurado: ${profiles[0].name}.`,
            },
            warnings: [],
        }
    }

    return {
        profile: null,
        decision: {
            strategy: "weighted_creation:profile",
            value: null,
            reason: "No existe un perfil de presentación aplicable para este producto weighted.",
        },
        warnings: [],
    }
}

export function buildWeightedPresentationVariantLabel(
    variant: WeightedPresentationProfileVariant
): string {
    return normalizeDisplayText(variant.label) || `${variant.grams} g`
}

export function buildWeightedPresentationVariantSku(
    baseSku: string,
    variant: WeightedPresentationProfileVariant
): string {
    const normalizedSuffix =
        normalizeCodeToken(variant.sku_suffix) || `${Math.round(variant.grams)}G`

    return `${baseSku}-${normalizedSuffix}`
}

export function getWeightedPresentationProfileById(
    profiles: WeightedPresentationProfile[],
    profileId: string | null | undefined
): WeightedPresentationProfile | null {
    if (!profileId) {
        return null
    }

    return profiles.find((profile) => profile.id === profileId) || null
}

function normalizeWeightedPresentationProfile(
    value: unknown,
    index: number
): WeightedPresentationProfile | null {
    const record = asRecord(value)
    if (!record) {
        return null
    }

    const name = normalizeDisplayText(record.name)
    const id = normalizeCodeToken(record.id) || normalizeCodeToken(name) || `profile-${index + 1}`
    const variants = normalizeWeightedPresentationProfileVariants(record.variants)

    if (!name || variants.length === 0) {
        return null
    }

    return {
        id,
        name,
        matcher: normalizeWeightedPresentationMatcher(record.matcher),
        variants,
    }
}

function normalizeWeightedPresentationProfileVariants(
    value: unknown
): WeightedPresentationProfileVariant[] {
    if (!Array.isArray(value)) {
        return []
    }

    const normalized = value
        .map((item) => normalizeWeightedPresentationProfileVariant(item))
        .filter((item): item is WeightedPresentationProfileVariant => !!item)
        .sort((left, right) => left.grams - right.grams)

    const deduped = new Map<number, WeightedPresentationProfileVariant>()
    for (const variant of normalized) {
        deduped.set(variant.grams, variant)
    }

    return Array.from(deduped.values())
}

function normalizeWeightedPresentationProfileVariant(
    value: unknown
): WeightedPresentationProfileVariant | null {
    const record = asRecord(value)
    if (!record) {
        return null
    }

    const grams = asPositiveNumber(record.grams)
    const pvpField = asWeightedPvpField(record.pvp_field)

    if (grams == null || pvpField == null) {
        return null
    }

    return {
        grams,
        pvp_field: pvpField,
        label: normalizeNullableDisplayText(record.label),
        sku_suffix: normalizeNullableCodeToken(record.sku_suffix),
    }
}

function normalizeWeightedPresentationMatcher(
    value: unknown
): WeightedPresentationProfileMatcher | null {
    const record = asRecord(value)
    if (!record) {
        return null
    }

    const next: WeightedPresentationProfileMatcher = {}
    const categoryIds = normalizeStringList(record.category_ids)
    const brandIds = normalizeStringList(record.brand_ids)
    const unitIds = normalizeStringList(record.unit_ids)
    const codePrefixes = normalizeStringList(
        record.code_prefixes,
        (item) => item.toUpperCase()
    )

    if (categoryIds.length > 0) {
        next.category_ids = categoryIds
    }
    if (brandIds.length > 0) {
        next.brand_ids = brandIds
    }
    if (unitIds.length > 0) {
        next.unit_ids = unitIds
    }
    if (codePrefixes.length > 0) {
        next.code_prefixes = codePrefixes
    }

    return hasWeightedPresentationMatcher(next) ? next : null
}

function weightedPresentationProfileMatchesProduct(
    profile: WeightedPresentationProfile,
    product: Pick<ContificoProducto, "codigo" | "categoria_id" | "marca_id" | "unidad">
): boolean {
    const matcher = profile.matcher
    if (!matcher || !hasWeightedPresentationMatcher(matcher)) {
        return false
    }

    if (
        matcher.category_ids?.length &&
        (!product.categoria_id || !matcher.category_ids.includes(product.categoria_id))
    ) {
        return false
    }

    if (
        matcher.brand_ids?.length &&
        (!product.marca_id || !matcher.brand_ids.includes(product.marca_id))
    ) {
        return false
    }

    if (
        matcher.unit_ids?.length &&
        (!product.unidad || !matcher.unit_ids.includes(product.unidad))
    ) {
        return false
    }

    if (
        matcher.code_prefixes?.length &&
        !matcher.code_prefixes.some((prefix) =>
            product.codigo.toUpperCase().startsWith(prefix)
        )
    ) {
        return false
    }

    return true
}

function hasWeightedPresentationMatcher(
    matcher: WeightedPresentationProfileMatcher | null | undefined
): boolean {
    return !!(
        matcher &&
        (
            matcher.category_ids?.length ||
            matcher.brand_ids?.length ||
            matcher.unit_ids?.length ||
            matcher.code_prefixes?.length
        )
    )
}

function normalizeStringList(
    value: unknown,
    transform?: (value: string) => string
): string[] {
    if (!Array.isArray(value)) {
        return []
    }

    const deduped = new Set<string>()
    for (const entry of value) {
        const normalized = normalizeDisplayText(entry)
        if (normalized) {
            deduped.add(transform ? transform(normalized) : normalized)
        }
    }

    return Array.from(deduped)
}

function normalizeDisplayText(value: unknown): string {
    return typeof value === "string" ? value.trim() : ""
}

function normalizeNullableDisplayText(value: unknown): string | null {
    const normalized = normalizeDisplayText(value)
    return normalized.length > 0 ? normalized : null
}

function normalizeCodeToken(value: unknown): string {
    return typeof value === "string"
        ? value
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
        : ""
}

function normalizeNullableCodeToken(value: unknown): string | null {
    const normalized = normalizeCodeToken(value)
    return normalized.length > 0 ? normalized.toUpperCase() : null
}

function asPositiveNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value
    }

    return null
}

function asWeightedPvpField(value: unknown): WeightedPvpField | null {
    switch (value) {
        case "pvp1":
        case "pvp2":
        case "pvp3":
        case "pvp4":
            return value
        default:
            return null
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}
