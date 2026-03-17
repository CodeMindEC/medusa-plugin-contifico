import { useState, useCallback } from "react"
import { toast } from "@medusajs/ui"
import type {
    AvailableMedusa,
    LinkedProduct,
    LinkStats,
    MatchStats,
    ProductMatch,
    RelinkCandidate,
    UnmatchedProduct,
} from "./shared"

// ── Types ────────────────────────────────────────────────

type TabId = "linked" | "suggestions"
export type WeightedPriceSyncOverrideValue = "" | "true" | "false"

export interface LinkedDefaultsState {
    variant_mode: "auto" | "contifico" | "simple" | "weighted"
    weighted_pvp_field: "pvp1" | "pvp2" | "pvp3" | "pvp4"
    weighted_price_sync_enabled: boolean
}

export interface MappingOverrideState {
    mapping_mode_override: string
    weighted_pvp_field: string
    weighted_price_sync_override: WeightedPriceSyncOverrideValue
}

const EMPTY_MAPPING_OVERRIDE: MappingOverrideState = {
    mapping_mode_override: "",
    weighted_pvp_field: "",
    weighted_price_sync_override: "",
}

// ── Helpers ──────────────────────────────────────────────

export function toWeightedPriceSyncOverrideValue(
    value: boolean | null | undefined
): WeightedPriceSyncOverrideValue {
    if (value == null) return ""
    return value ? "true" : "false"
}

export function fromWeightedPriceSyncOverrideValue(
    value: WeightedPriceSyncOverrideValue
): boolean | null {
    if (value === "") return null
    return value === "true"
}

export function buildMappingOverride(item: LinkedProduct): MappingOverrideState {
    return {
        mapping_mode_override: item.mapping_mode_override || "",
        weighted_pvp_field: item.weighted_pvp_field_override || "",
        weighted_price_sync_override: toWeightedPriceSyncOverrideValue(
            item.weighted_price_sync_override
        ),
    }
}

export function getAvailableRelinkOptions(
    options: AvailableMedusa[],
    linkedProducts: LinkedProduct[]
): AvailableMedusa[] {
    const linkedMedusaIds = new Set(linkedProducts.map((p) => p.medusa_id))
    return options.filter((o) => !linkedMedusaIds.has(o.medusa_id))
}

export function getLinkSkipFeedback(reason: string) {
    if (reason === "Ya existe un mapeo para este producto de Medusa") {
        return {
            title: "Producto ya vinculado",
            description: "El producto Medusa seleccionado ya esta vinculado a otro producto de Contifico.",
        }
    }
    if (reason === "Ya existe un mapeo para este producto de Contifico") {
        return {
            title: "Producto Contifico ya vinculado",
            description: "Este producto de Contifico ya tiene un mapeo activo con otro producto de Medusa.",
        }
    }
    if (reason === "El vínculo ya existe") {
        return { title: "Vinculo existente", description: "Ese producto ya esta vinculado." }
    }
    return { title: "No se pudo vincular", description: reason }
}

// ── Hook ─────────────────────────────────────────────────

export function useProductLinkState() {
    const [activeTab, setActiveTab] = useState<TabId>("linked")

    // Linked state
    const [linked, setLinked] = useState<LinkedProduct[]>([])
    const [linkStats, setLinkStats] = useState<LinkStats | null>(null)
    const [isLoadingLinked, setIsLoadingLinked] = useState(false)
    const [linkedFilter, setLinkedFilter] = useState("")
    const [allMedusa, setAllMedusa] = useState<AvailableMedusa[]>([])
    const [linkedDefaults, setLinkedDefaults] = useState<LinkedDefaultsState | null>(null)
    const [relinkingId, setRelinkingId] = useState<string | null>(null)
    const [relinkSelection, setRelinkSelection] = useState("")
    const [mappingOverrides, setMappingOverrides] = useState<Record<string, MappingOverrideState>>({})

    // Match/suggestions state
    const [matches, setMatches] = useState<ProductMatch[]>([])
    const [unmatched, setUnmatched] = useState<UnmatchedProduct[]>([])
    const [relinkCandidates, setRelinkCandidates] = useState<RelinkCandidate[]>([])
    const [availableMedusa, setAvailableMedusa] = useState<AvailableMedusa[]>([])
    const [matchStats, setMatchStats] = useState<MatchStats | null>(null)
    const [isLoadingMatches, setIsLoadingMatches] = useState(false)
    const [isUnlinking, setIsUnlinking] = useState(false)
    const [hasLoadedMatches, setHasLoadedMatches] = useState(false)
    const [hasLoadedLinked, setHasLoadedLinked] = useState(false)
    const [suggestionsFilter, setSuggestionsFilter] = useState("")
    const [suggestionsView, setSuggestionsView] = useState<"all" | "matched" | "unmatched" | "relink">("all")
    const [manualSelections, setManualSelections] = useState<Record<string, string>>({})
    const [linkingId, setLinkingId] = useState<string | null>(null)

    const availableRelinkOptions = getAvailableRelinkOptions(allMedusa, linked)

    const updateMappingOverride = useCallback(
        (contificoId: string, patch: Partial<MappingOverrideState>) => {
            setMappingOverrides((prev) => ({
                ...prev,
                [contificoId]: {
                    ...(prev[contificoId] || EMPTY_MAPPING_OVERRIDE),
                    ...patch,
                },
            }))
        },
        []
    )

    const fetchLinked = useCallback(async () => {
        setIsLoadingLinked(true)
        try {
            const res = await fetch("/admin/contifico/products/linked", {
                credentials: "include",
            })
            const data = await res.json()
            if (data.error) {
                toast.error("Error", { description: data.error })
                return
            }
            setLinked(data.linked || [])
            setLinkStats(data.stats || null)
            setAllMedusa(data.all_medusa || [])
            setLinkedDefaults(data.defaults || null)
            setMappingOverrides(
                Object.fromEntries(
                    (data.linked || []).map((item: LinkedProduct) => [
                        item.contifico_id,
                        buildMappingOverride(item),
                    ])
                )
            )
            setHasLoadedLinked(true)
        } catch (err) {
            toast.error("Error", { description: (err as Error).message })
        } finally {
            setIsLoadingLinked(false)
        }
    }, [])

    const fetchMatches = useCallback(async () => {
        setIsLoadingMatches(true)
        setManualSelections({})
        try {
            const res = await fetch("/admin/contifico/products/match", {
                credentials: "include",
            })
            const data = await res.json()
            if (data.error) {
                toast.error("Error", { description: data.error })
                return
            }
            setMatches(data.matches || [])
            setUnmatched(data.unmatched || [])
            setRelinkCandidates(data.relink_candidates || [])
            setAvailableMedusa(data.available_medusa || [])
            setMatchStats(data.stats || null)
            setHasLoadedMatches(true)
        } catch (err) {
            toast.error("Error", { description: (err as Error).message })
        } finally {
            setIsLoadingMatches(false)
        }
    }, [])

    const handleLinkSingle = async (
        contificoId: string,
        medusaId: string,
        contificoCodigo: string,
        contificoNombre: string,
        contificoImagen: string | null
    ) => {
        setLinkingId(contificoId)
        try {
            const res = await fetch("/admin/contifico/products/link", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    links: [{
                        contifico_id: contificoId,
                        medusa_id: medusaId,
                        contifico_codigo: contificoCodigo,
                        contifico_nombre: contificoNombre,
                        contifico_imagen: contificoImagen,
                    }],
                }),
            })
            const data = await res.json()
            if (data.error) {
                toast.error("Error", { description: data.error })
                return
            }
            const skippedReason = data?.details?.skipped?.[0]?.reason
            if (!data?.linked && skippedReason) {
                const feedback = getLinkSkipFeedback(skippedReason)
                toast.error(feedback.title, { description: feedback.description })
                return
            }
            toast.success("Vinculado", { description: `"${contificoNombre}" vinculado correctamente` })
            setMatches((prev) => prev.filter((m) => m.contifico_id !== contificoId))
            setUnmatched((prev) => prev.filter((u) => u.contifico_id !== contificoId))
            setAvailableMedusa((prev) => prev.filter((m) => m.medusa_id !== medusaId))
            setManualSelections((prev) => {
                const next = { ...prev }
                delete next[contificoId]
                return next
            })
            if (matchStats) {
                setMatchStats({ ...matchStats, already_linked: matchStats.already_linked + 1 })
            }
            setHasLoadedLinked(false)
        } catch (err) {
            toast.error("Error", { description: (err as Error).message })
        } finally {
            setLinkingId(null)
        }
    }

    const handleUnlink = async (medusaId: string, nombre: string) => {
        if (!confirm(`¿Desvincular "${nombre}"?`)) return
        setIsUnlinking(true)
        try {
            const res = await fetch("/admin/contifico/products/link", {
                method: "DELETE",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ medusa_id: medusaId }),
            })
            const data = await res.json()
            if (data.error) {
                toast.error("Error", { description: data.error })
                return
            }
            toast.success("Desvinculado", { description: `"${nombre}" desvinculado` })
            setLinked((prev) => prev.filter((l) => l.medusa_id !== medusaId))
            if (linkStats) {
                setLinkStats({ ...linkStats, total_linked: linkStats.total_linked - 1 })
            }
        } catch (err) {
            toast.error("Error", { description: (err as Error).message })
        } finally {
            setIsUnlinking(false)
        }
    }

    const handleRelink = async (contificoId: string, newMedusaId: string, nombre: string) => {
        setLinkingId(contificoId)
        try {
            const res = await fetch("/admin/contifico/products/link", {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contifico_id: contificoId, new_medusa_id: newMedusaId }),
            })
            const data = await res.json()
            if (data.error) {
                toast.error("Error", { description: data.error })
                return
            }
            const priceUpdateCount =
                typeof data?.price_updated === "number"
                    ? data.price_updated
                    : typeof data?.weighted_price_updated === "number"
                      ? data.weighted_price_updated
                      : 0
            const successDescription = data.warning
                ? data.warning
                : priceUpdateCount > 0
                  ? `"${nombre}" ahora apunta al nuevo producto Medusa y sincronizo ${priceUpdateCount} precio(s).`
                  : `"${nombre}" ahora apunta al nuevo producto Medusa`
            toast.success(data.warning ? "Re-vinculado con advertencia" : "Re-vinculado", {
                description: successDescription,
            })
            setRelinkingId(null)
            setRelinkSelection("")
            setRelinkCandidates((prev) => prev.filter((r) => r.contifico_id !== contificoId))
            setHasLoadedLinked(false)
            fetchLinked()
        } catch (err) {
            toast.error("Error", { description: (err as Error).message })
        } finally {
            setLinkingId(null)
        }
    }

    const handleSaveMapping = async (item: LinkedProduct) => {
        const override = mappingOverrides[item.contifico_id] || EMPTY_MAPPING_OVERRIDE
        setLinkingId(item.contifico_id)
        try {
            const res = await fetch("/admin/contifico/products/link", {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contifico_id: item.contifico_id,
                    mapping_mode_override: override.mapping_mode_override || null,
                    weighted_pvp_field: override.weighted_pvp_field || null,
                    weighted_price_sync_override: fromWeightedPriceSyncOverrideValue(
                        override.weighted_price_sync_override
                    ),
                }),
            })
            const data = await res.json()
            if (data.error) {
                toast.error("Error", { description: data.error })
                return
            }
            toast.success("Mapeo actualizado", {
                description: `"${item.contifico_nombre}" actualizado`,
            })
            fetchLinked()
        } catch (err) {
            toast.error("Error", { description: (err as Error).message })
        } finally {
            setLinkingId(null)
        }
    }

    const filteredLinked = linked.filter((l) => {
        if (!linkedFilter) return true
        const q = linkedFilter.toLowerCase()
        return (
            l.contifico_nombre.toLowerCase().includes(q) ||
            l.contifico_codigo.toLowerCase().includes(q) ||
            l.medusa_title.toLowerCase().includes(q) ||
            (l.medusa_sku && l.medusa_sku.toLowerCase().includes(q))
        )
    })

    return {
        // Tab
        activeTab,
        setActiveTab,
        // Linked
        linked,
        linkStats,
        isLoadingLinked,
        linkedFilter,
        setLinkedFilter,
        allMedusa,
        linkedDefaults,
        relinkingId,
        setRelinkingId,
        relinkSelection,
        setRelinkSelection,
        mappingOverrides,
        updateMappingOverride,
        filteredLinked,
        hasLoadedLinked,
        availableRelinkOptions,
        // Suggestions
        matches,
        unmatched,
        relinkCandidates,
        availableMedusa,
        matchStats,
        isLoadingMatches,
        isUnlinking,
        hasLoadedMatches,
        suggestionsFilter,
        setSuggestionsFilter,
        suggestionsView,
        setSuggestionsView,
        manualSelections,
        setManualSelections,
        linkingId,
        // Actions
        fetchLinked,
        fetchMatches,
        handleLinkSingle,
        handleUnlink,
        handleRelink,
        handleSaveMapping,
    }
}

export type ProductLinkState = ReturnType<typeof useProductLinkState>
