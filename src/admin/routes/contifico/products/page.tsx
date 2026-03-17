import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
    Container,
    Heading,
    Button,
    Text,
    Badge,
    Table,
    Toaster,
    toast,
    Input,
    Select,
} from "@medusajs/ui"
import { ArrowUturnLeft, XMark, PencilSquare } from "@medusajs/icons"
import { useState, useCallback, type ReactNode } from "react"
import type { RulesByWeightStrategyConfig } from "../../../../lib/weighted-price-strategies"
import {
    AvailableMedusa,
    ContificoCell,
    LinkedProduct,
    LinkStats,
    mappingModeLabel,
    matchTypeColor,
    matchTypeLabel,
    MatchStats,
    MedusaSelect,
    ProductMatch,
    RelinkCandidate,
    SimilarityBadge,
    UnmatchedProduct,
    weightedPvpOptions,
} from "./shared"

type TabId = "linked" | "suggestions"
const EMPTY_SELECT_VALUE = "__empty__"
type WeightedPriceSyncOverrideValue = "" | "true" | "false"

interface LinkedDefaultsState {
    variant_mode: "auto" | "contifico" | "simple" | "weighted"
    weighted_pvp_field: "pvp1" | "pvp2" | "pvp3" | "pvp4"
    weighted_price_sync_enabled: boolean
}

interface MappingOverrideState {
    mapping_mode_override: string
    weighted_pvp_field: string
    weighted_price_sync_override: WeightedPriceSyncOverrideValue
}

const EMPTY_MAPPING_OVERRIDE: MappingOverrideState = {
    mapping_mode_override: "",
    weighted_pvp_field: "",
    weighted_price_sync_override: "",
}

function InlineSelect({
    value,
    onValueChange,
    placeholder,
    children,
}: {
    value: string
    onValueChange: (value: string) => void
    placeholder: string
    children: ReactNode
}) {
    return (
        <Select
            value={value || EMPTY_SELECT_VALUE}
            onValueChange={(nextValue) =>
                onValueChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)
            }
            size="small"
        >
            <Select.Trigger className="w-full">
                <Select.Value placeholder={placeholder} />
            </Select.Trigger>
            <Select.Content>
                <Select.Item value={EMPTY_SELECT_VALUE}>{placeholder}</Select.Item>
                {children}
            </Select.Content>
        </Select>
    )
}

function toWeightedPriceSyncOverrideValue(
    value: boolean | null | undefined
): WeightedPriceSyncOverrideValue {
    if (value == null) {
        return ""
    }

    return value ? "true" : "false"
}

function fromWeightedPriceSyncOverrideValue(
    value: WeightedPriceSyncOverrideValue
): boolean | null {
    if (value === "") {
        return null
    }

    return value === "true"
}

function buildMappingOverride(item: LinkedProduct): MappingOverrideState {
    return {
        mapping_mode_override: item.mapping_mode_override || "",
        weighted_pvp_field: item.weighted_pvp_field_override || "",
        weighted_price_sync_override: toWeightedPriceSyncOverrideValue(
            item.weighted_price_sync_override
        ),
    }
}

function getAvailableRelinkOptions(
    options: AvailableMedusa[],
    linkedProducts: LinkedProduct[]
): AvailableMedusa[] {
    const linkedMedusaIds = new Set(linkedProducts.map((product) => product.medusa_id))
    return options.filter((option) => !linkedMedusaIds.has(option.medusa_id))
}

function getLinkSkipFeedback(reason: string) {
    if (reason === "Ya existe un mapeo para este producto de Medusa") {
        return {
            title: "Producto ya vinculado",
            description:
                "El producto Medusa seleccionado ya esta vinculado a otro producto de Contifico.",
        }
    }

    if (reason === "Ya existe un mapeo para este producto de Contifico") {
        return {
            title: "Producto Contifico ya vinculado",
            description:
                "Este producto de Contifico ya tiene un mapeo activo con otro producto de Medusa.",
        }
    }

    if (reason === "El vínculo ya existe") {
        return {
            title: "Vinculo existente",
            description: "Ese producto ya esta vinculado.",
        }
    }

    return {
        title: "No se pudo vincular",
        description: reason,
    }
}

// ── Component ──────────────────────────────────────────────

const ProductMatchPage = () => {
    const [activeTab, setActiveTab] = useState<TabId>("linked")

    // Linked state
    const [linked, setLinked] = useState<LinkedProduct[]>([])
    const [linkStats, setLinkStats] = useState<LinkStats | null>(null)
    const [isLoadingLinked, setIsLoadingLinked] = useState(false)
    const [linkedFilter, setLinkedFilter] = useState("")
    const [allMedusa, setAllMedusa] = useState<AvailableMedusa[]>([])
    const [linkedDefaults, setLinkedDefaults] = useState<LinkedDefaultsState | null>(null)
    const [relinkingId, setRelinkingId] = useState<string | null>(null) // contifico_id being re-linked
    const [relinkSelection, setRelinkSelection] = useState<string>("") // new medusa_id
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
    // Manual selections: contificoId → medusaId
    const [manualSelections, setManualSelections] = useState<Record<string, string>>({})
    const [linkingId, setLinkingId] = useState<string | null>(null)

    const originBadge = (product: LinkedProduct) => {
        if (product.link_origin === "plugin_created") {
            return { color: "blue" as const, label: "Plugin" }
        }

        if (product.auto_linked) {
            return { color: "purple" as const, label: "Auto" }
        }

        if (product.link_origin === "relinked_to_existing") {
            return { color: "orange" as const, label: "Re-link" }
        }

        return { color: "grey" as const, label: "Manual" }
    }
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

    // ── Fetch linked products ──
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

    // ── Fetch match suggestions ──
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

    // ── Link a single product (auto-matched or manually selected) ──
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
            // Remove from matches and unmatched
            setMatches((prev) => prev.filter((m) => m.contifico_id !== contificoId))
            setUnmatched((prev) => prev.filter((u) => u.contifico_id !== contificoId))
            // Remove used Medusa product from available list
            setAvailableMedusa((prev) => prev.filter((m) => m.medusa_id !== medusaId))
            // Clear manual selection
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

    // ── Unlink single product ──
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

    // ── Re-link product ──
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
            // Remove from relink candidates
            setRelinkCandidates((prev) => prev.filter((r) => r.contifico_id !== contificoId))
            // Reload linked list
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

    // ── Filter helpers ──
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

    // ── Tabs ──
    const tabs: Array<{ id: TabId; label: string; count?: number }> = [
        { id: "linked", label: "Vinculados", count: linkStats?.total_linked },
        { id: "suggestions", label: "Sugerencias", count: hasLoadedMatches ? matches.length : undefined },
    ]

    return (
        <>
            <Toaster />
            <Container className="p-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <a href="/app/contifico" className="text-ui-fg-subtle hover:text-ui-fg-base">
                                <ArrowUturnLeft />
                            </a>
                            <Heading level="h1">Mapeo de Productos</Heading>
                        </div>
                        <Text className="text-ui-fg-subtle">
                            Gestiona la vinculación entre productos de Contifico y Medusa.
                        </Text>
                    </div>
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 mb-6 border-b border-ui-border-base">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id)
                                if (tab.id === "linked" && !hasLoadedLinked) fetchLinked()
                                if (tab.id === "suggestions" && !hasLoadedMatches) fetchMatches()
                            }}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id
                                    ? "border-ui-fg-base text-ui-fg-base"
                                    : "border-transparent text-ui-fg-subtle hover:text-ui-fg-muted"
                                }`}
                        >
                            {tab.label}
                            {tab.count !== undefined && (
                                <span className="ml-1.5 text-xs bg-ui-bg-subtle-hover rounded-full px-1.5 py-0.5">
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* ═══════════ TAB: VINCULADOS ═══════════ */}
                {activeTab === "linked" && (
                    <>
                        {!hasLoadedLinked ? (
                            <Container className="p-8 text-center">
                                <Button onClick={fetchLinked} isLoading={isLoadingLinked}>
                                    Cargar productos vinculados
                                </Button>
                            </Container>
                        ) : (
                            <>
                                {/* Stats */}
                                {linkStats && (
                                    <div className="grid grid-cols-2 gap-4 mb-4">
                                        <Container className="p-4 text-center">
                                            <Text className="text-ui-fg-subtle text-xs">Vinculados</Text>
                                            <Text weight="plus" className="text-xl text-ui-fg-positive">{linkStats.total_linked}</Text>
                                        </Container>
                                        <Container className="p-4 text-center">
                                            <Text className="text-ui-fg-subtle text-xs">Medusa total</Text>
                                            <Text weight="plus" className="text-xl">{linkStats.medusa_total}</Text>
                                        </Container>
                                    </div>
                                )}

                                <div className="flex items-center gap-3 mb-4">
                                    <Input
                                        placeholder="Filtrar por nombre, código o SKU..."
                                        value={linkedFilter}
                                        onChange={(e) => setLinkedFilter(e.target.value)}
                                        className="max-w-sm"
                                    />
                                    <Button variant="secondary" size="small" onClick={fetchLinked} isLoading={isLoadingLinked}>
                                        Recargar
                                    </Button>
                                </div>

                                {filteredLinked.length === 0 ? (
                                    <Container className="p-8 text-center">
                                        <Text className="text-ui-fg-subtle">
                                            {linkedFilter ? "No hay resultados para ese filtro." : "No hay productos vinculados."}
                                        </Text>
                                    </Container>
                                ) : (
                                    <Container className="p-0 overflow-x-auto">
                                        <Table>
                                            <Table.Header>
                                                <Table.Row>
                                                    <Table.HeaderCell>Contifico</Table.HeaderCell>
                                                    <Table.HeaderCell>Medusa</Table.HeaderCell>
                                                    <Table.HeaderCell className="w-24 text-center">Tipo</Table.HeaderCell>
                                                    <Table.HeaderCell className="w-24 text-center">Origen</Table.HeaderCell>
                                                    <Table.HeaderCell className="min-w-[280px]">Mapeo</Table.HeaderCell>
                                                    <Table.HeaderCell className="w-16"></Table.HeaderCell>
                                                </Table.Row>
                                            </Table.Header>
                                            <Table.Body>
                                                {filteredLinked.map((l) => (
                                                    <Table.Row key={l.map_id}>
                                                        <Table.Cell>
                                                            <ContificoCell
                                                                nombre={l.contifico_nombre}
                                                                codigo={l.contifico_codigo}
                                                            />
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            {relinkingId === l.contifico_id ? (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="flex-1">
                                                                        <MedusaSelect
                                                                            value={relinkSelection}
                                                                            onChange={setRelinkSelection}
                                                                            options={availableRelinkOptions}
                                                                            placeholder="Sin vínculo"
                                                                        />
                                                                    </div>
                                                                    <Button
                                                                        size="small"
                                                                        disabled={!relinkSelection}
                                                                        onClick={() => handleRelink(l.contifico_id, relinkSelection, l.contifico_nombre)}
                                                                    >
                                                                        Guardar
                                                                    </Button>
                                                                    <button
                                                                        onClick={() => { setRelinkingId(null); setRelinkSelection("") }}
                                                                        className="text-ui-fg-subtle hover:text-ui-fg-base p-1"
                                                                    >
                                                                        <XMark />
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div>
                                                                    <Text weight="plus" className="text-sm">{l.medusa_title}</Text>
                                                                    {l.medusa_sku && (
                                                                        <Text className="text-xs text-ui-fg-subtle">SKU: {l.medusa_sku}</Text>
                                                                    )}
                                                                    {l.medusa_missing && (
                                                                        <Text className="text-xs text-ui-fg-subtle">
                                                                            El vínculo actual ya no existe en Medusa.
                                                                        </Text>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            {l.match_type && (
                                                                <Badge color={matchTypeColor[l.match_type] || "grey"}>
                                                                    {matchTypeLabel[l.match_type] || l.match_type}
                                                                </Badge>
                                                            )}
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            <Badge color={originBadge(l).color}>
                                                                {originBadge(l).label}
                                                            </Badge>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                                <div className="space-y-2">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <Badge color={l.mapping_mode === "weighted" ? "orange" : "grey"}>
                                                                            {mappingModeLabel[l.mapping_mode]}
                                                                        </Badge>
                                                                        <Badge
                                                                            color={
                                                                                l.weighted_price_sync_enabled
                                                                                    ? "blue"
                                                                                    : "grey"
                                                                            }
                                                                        >
                                                                            {l.weighted_price_sync_enabled
                                                                                ? "Precio desde Contífico"
                                                                                : "Precio manual Medusa"}
                                                                        </Badge>
                                                                    {l.mapping_mode === "weighted" && (
                                                                        <Badge color={l.weighted_ready ? "green" : "red"}>
                                                                            {l.weighted_variants_ready}/{l.weighted_variants_total} con peso
                                                                        </Badge>
                                                                    )}
                                                                    <Text className="text-xs text-ui-fg-subtle">
                                                                        {l.effective_rules?.weighted.pricing_strategy === "rules_by_weight"
                                                                            ? `Precio weighted: reglas por peso (${((l.effective_rules.weighted.strategy_config as RulesByWeightStrategyConfig | undefined)?.rules || []).length} regla(s))`
                                                                            : `Precio weighted: campo fijo ${l.weighted_pvp_field.toUpperCase()}`}
                                                                    </Text>
                                                                </div>
                                                                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                                                                    <InlineSelect
                                                                        value={mappingOverrides[l.contifico_id]?.mapping_mode_override || ""}
                                                                        onValueChange={(nextValue) =>
                                                                            updateMappingOverride(l.contifico_id, {
                                                                                mapping_mode_override: nextValue,
                                                                            })
                                                                        }
                                                                        placeholder={`Usar global (${mappingModeLabel[linkedDefaults?.variant_mode || "auto"]})`}
                                                                    >
                                                                        <Select.Item value="auto">Automático</Select.Item>
                                                                        <Select.Item value="contifico">Variantes de Contifico</Select.Item>
                                                                        <Select.Item value="simple">Variante única</Select.Item>
                                                                        <Select.Item value="weighted">Producto base por peso</Select.Item>
                                                                    </InlineSelect>
                                                                    <InlineSelect
                                                                        value={mappingOverrides[l.contifico_id]?.weighted_pvp_field || ""}
                                                                        onValueChange={(nextValue) =>
                                                                            updateMappingOverride(l.contifico_id, {
                                                                                weighted_pvp_field: nextValue,
                                                                            })
                                                                        }
                                                                        placeholder={`Usar global (${(linkedDefaults?.weighted_pvp_field || "pvp1").toUpperCase()})`}
                                                                    >
                                                                        {weightedPvpOptions.map((field) => (
                                                                            <Select.Item key={field} value={field}>
                                                                                {field.toUpperCase()}
                                                                            </Select.Item>
                                                                        ))}
                                                                    </InlineSelect>
                                                                    <InlineSelect
                                                                        value={
                                                                            mappingOverrides[l.contifico_id]
                                                                                ?.weighted_price_sync_override || ""
                                                                        }
                                                                        onValueChange={(nextValue) =>
                                                                            updateMappingOverride(l.contifico_id, {
                                                                                weighted_price_sync_override:
                                                                                    nextValue as WeightedPriceSyncOverrideValue,
                                                                            })
                                                                        }
                                                                        placeholder={`Usar global (${linkedDefaults?.weighted_price_sync_enabled ? "Contífico" : "manual"})`}
                                                                    >
                                                                        <Select.Item value="true">
                                                                            Seguir a Contífico
                                                                        </Select.Item>
                                                                        <Select.Item value="false">
                                                                            Dejar manual en Medusa
                                                                        </Select.Item>
                                                                    </InlineSelect>
                                                                    <Button
                                                                        size="small"
                                                                        variant="secondary"
                                                                        onClick={() => handleSaveMapping(l)}
                                                                        isLoading={linkingId === l.contifico_id}
                                                                        disabled={linkingId !== null}
                                                                    >
                                                                        Guardar
                                                                    </Button>
                                                                </div>
                                                                {l.mapping_mode === "weighted" && !l.weighted_ready && (
                                                                    <Text className="text-xs text-ui-fg-destructive">
                                                                        Faltan pesos en: {l.weighted_missing_variants.join(", ")}
                                                                    </Text>
                                                                )}
                                                                {l.mapping_mode === "weighted" && l.weighted_variant_weights.length > 0 && (
                                                                    <Text className="text-xs text-ui-fg-subtle">
                                                                        Pesos leídos: {l.weighted_variant_weights
                                                                            .map((item) =>
                                                                                item.grams != null
                                                                                    ? `${item.label}=${item.grams} g`
                                                                                    : `${item.label}=sin peso`
                                                                            )
                                                                            .join(", ")}
                                                                    </Text>
                                                                )}
                                                            </div>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    onClick={() => {
                                                                        setRelinkingId(l.contifico_id)
                                                                        setRelinkSelection("")
                                                                    }}
                                                                    disabled={isUnlinking || relinkingId !== null}
                                                                    className="text-ui-fg-subtle hover:text-ui-fg-interactive transition-colors p-1"
                                                                    title="Cambiar producto Medusa"
                                                                >
                                                                    <PencilSquare />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleUnlink(l.medusa_id, l.contifico_nombre)}
                                                                    disabled={isUnlinking || relinkingId !== null}
                                                                    className="text-ui-fg-subtle hover:text-ui-fg-destructive transition-colors p-1"
                                                                    title="Desvincular"
                                                                >
                                                                    <XMark />
                                                                </button>
                                                            </div>
                                                        </Table.Cell>
                                                    </Table.Row>
                                                ))}
                                            </Table.Body>
                                        </Table>
                                    </Container>
                                )}
                            </>
                        )}
                    </>
                )}

                {/* ═══════════ TAB: SUGERENCIAS + MANUAL ═══════════ */}
                {activeTab === "suggestions" && (
                    <>
                        {/* Analyze button */}
                        <div className="flex justify-end mb-4">
                            <Button onClick={fetchMatches} isLoading={isLoadingMatches}>
                                {hasLoadedMatches ? "Reanalizar" : "Analizar Productos"}
                            </Button>
                        </div>

                        {/* Match Stats */}
                        {matchStats && (
                            <Container className="mb-4 p-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="text-center">
                                        <Text className="text-ui-fg-subtle text-xs">Contifico</Text>
                                        <Text weight="plus" className="text-lg">{matchStats.contifico_total}</Text>
                                    </div>
                                    <div className="text-center">
                                        <Text className="text-ui-fg-subtle text-xs">Medusa</Text>
                                        <Text weight="plus" className="text-lg">{matchStats.medusa_total}</Text>
                                    </div>
                                    <div className="text-center">
                                        <Text className="text-ui-fg-subtle text-xs">Ya vinculados</Text>
                                        <Text weight="plus" className="text-lg text-ui-fg-positive">{matchStats.already_linked}</Text>
                                    </div>
                                    <div className="text-center">
                                        <Text className="text-ui-fg-subtle text-xs">Sin match</Text>
                                        <Text weight="plus" className="text-lg text-ui-fg-destructive">{matchStats.unmatched_contifico}</Text>
                                    </div>
                                </div>
                                <div className="flex gap-2 justify-center mt-3">
                                    {matchStats.exact_sku > 0 && <Badge color="green">{matchStats.exact_sku} SKU exacto</Badge>}
                                    {matchStats.exact_name > 0 && <Badge color="blue">{matchStats.exact_name} nombre exacto</Badge>}
                                    {matchStats.barcode > 0 && <Badge color="purple">{matchStats.barcode} cod. barras</Badge>}
                                    {matchStats.similar > 0 && <Badge color="orange">{matchStats.similar} similares</Badge>}
                                    {matchStats.relink_candidates > 0 && <Badge color="red">{matchStats.relink_candidates} posibles duplicados</Badge>}
                                </div>
                            </Container>
                        )}

                        {/* Filter bar */}
                        {hasLoadedMatches && (matches.length > 0 || unmatched.length > 0 || relinkCandidates.length > 0) && (
                            <div className="flex items-center gap-3 mb-4">
                                <Input
                                    placeholder="Filtrar por nombre o código..."
                                    value={suggestionsFilter}
                                    onChange={(e) => setSuggestionsFilter(e.target.value)}
                                    className="max-w-sm"
                                />
                                <div className="flex gap-1 flex-wrap">
                                    <Button
                                        variant={suggestionsView === "all" ? "primary" : "secondary"}
                                        size="small"
                                        onClick={() => setSuggestionsView("all")}
                                    >
                                        Todos ({matches.length + unmatched.length + relinkCandidates.length})
                                    </Button>
                                    {relinkCandidates.length > 0 && (
                                        <Button
                                            variant={suggestionsView === "relink" ? "primary" : "secondary"}
                                            size="small"
                                            onClick={() => setSuggestionsView("relink")}
                                        >
                                            ⚠️ Re-vincular ({relinkCandidates.length})
                                        </Button>
                                    )}
                                    {matches.length > 0 && (
                                        <Button
                                            variant={suggestionsView === "matched" ? "primary" : "secondary"}
                                            size="small"
                                            onClick={() => setSuggestionsView("matched")}
                                        >
                                            Con sugerencia ({matches.length})
                                        </Button>
                                    )}
                                    {unmatched.length > 0 && (
                                        <Button
                                            variant={suggestionsView === "unmatched" ? "primary" : "secondary"}
                                            size="small"
                                            onClick={() => setSuggestionsView("unmatched")}
                                        >
                                            Sin match ({unmatched.length})
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Results */}
                        {!hasLoadedMatches ? (
                            <Container className="p-8 text-center">
                                <Text className="text-ui-fg-subtle">
                                    Haz clic en "Analizar Productos" para buscar coincidencias entre Contifico y Medusa.
                                </Text>
                            </Container>
                        ) : matches.length === 0 && unmatched.length === 0 && relinkCandidates.length === 0 ? (
                            <Container className="p-8 text-center">
                                <Text className="text-ui-fg-subtle">
                                    ¡Todos los productos están vinculados!
                                    {matchStats && matchStats.already_linked > 0 ? ` (${matchStats.already_linked} producto(s) vinculados)` : ""}
                                </Text>
                            </Container>
                        ) : (
                            <Container className="p-0 overflow-x-auto">
                                <Table>
                                    <Table.Header>
                                        <Table.Row>
                                            <Table.HeaderCell>Contifico</Table.HeaderCell>
                                            <Table.HeaderCell>Medusa (match/manual)</Table.HeaderCell>
                                            <Table.HeaderCell className="w-28 text-center">Match</Table.HeaderCell>
                                            <Table.HeaderCell className="w-28 text-center">Acción</Table.HeaderCell>
                                        </Table.Row>
                                    </Table.Header>
                                    <Table.Body>
                                        {/* Auto-matched products */}
                                        {(suggestionsView === "all" || suggestionsView === "matched") &&
                                            matches
                                                .filter((m) => {
                                                    if (!suggestionsFilter) return true
                                                    const q = suggestionsFilter.toLowerCase()
                                                    return m.contifico_nombre.toLowerCase().includes(q) ||
                                                        m.contifico_codigo.toLowerCase().includes(q) ||
                                                        m.medusa_title.toLowerCase().includes(q)
                                                })
                                                .map((m) => (
                                                    <Table.Row key={m.contifico_id}>
                                                        <Table.Cell>
                                                            <ContificoCell
                                                                nombre={m.contifico_nombre}
                                                                codigo={m.contifico_codigo}
                                                            />
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <div>
                                                                <Text weight="plus" className="text-sm">{m.medusa_title}</Text>
                                                                {m.medusa_sku && <Text className="text-xs text-ui-fg-subtle">SKU: {m.medusa_sku}</Text>}
                                                            </div>
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <SimilarityBadge score={m.similarity} />
                                                                <Badge color={matchTypeColor[m.match_type]}>{matchTypeLabel[m.match_type]}</Badge>
                                                            </div>
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            <Button
                                                                size="small"
                                                                onClick={() => handleLinkSingle(
                                                                    m.contifico_id, m.medusa_id,
                                                                    m.contifico_codigo, m.contifico_nombre,
                                                                    m.contifico_imagen || null
                                                                )}
                                                                isLoading={linkingId === m.contifico_id}
                                                                disabled={linkingId !== null}
                                                            >
                                                                Vincular
                                                            </Button>
                                                        </Table.Cell>
                                                    </Table.Row>
                                                ))}

                                        {/* Unmatched products (manual linking) */}
                                        {(suggestionsView === "all" || suggestionsView === "unmatched") &&
                                            unmatched
                                                .filter((u) => {
                                                    if (!suggestionsFilter) return true
                                                    const q = suggestionsFilter.toLowerCase()
                                                    return u.contifico_nombre.toLowerCase().includes(q) ||
                                                        u.contifico_codigo.toLowerCase().includes(q)
                                                })
                                                .map((u) => (
                                                    <Table.Row key={u.contifico_id} className="bg-ui-bg-subtle">
                                                        <Table.Cell>
                                                            <ContificoCell
                                                                nombre={u.contifico_nombre}
                                                                codigo={u.contifico_codigo}
                                                            />
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <MedusaSelect
                                                                value={manualSelections[u.contifico_id] || ""}
                                                                onChange={(val) => setManualSelections(prev => ({ ...prev, [u.contifico_id]: val }))}
                                                                options={availableMedusa}
                                                            />
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            <Badge color="red">Sin match</Badge>
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            <Button
                                                                size="small"
                                                                disabled={!manualSelections[u.contifico_id] || linkingId !== null}
                                                                isLoading={linkingId === u.contifico_id}
                                                                onClick={() => {
                                                                    const medusaId = manualSelections[u.contifico_id]
                                                                    if (medusaId) {
                                                                        handleLinkSingle(
                                                                            u.contifico_id, medusaId,
                                                                            u.contifico_codigo, u.contifico_nombre,
                                                                            u.contifico_imagen || null
                                                                        )
                                                                    }
                                                                }}
                                                            >
                                                                Vincular
                                                            </Button>
                                                        </Table.Cell>
                                                    </Table.Row>
                                                ))}

                                        {/* Relink candidates (plugin-created duplicates) */}
                                        {(suggestionsView === "all" || suggestionsView === "relink") &&
                                            relinkCandidates
                                                .filter((r) => {
                                                    if (!suggestionsFilter) return true
                                                    const q = suggestionsFilter.toLowerCase()
                                                    return r.contifico_nombre.toLowerCase().includes(q) ||
                                                        r.contifico_codigo.toLowerCase().includes(q) ||
                                                        r.current_medusa_title.toLowerCase().includes(q)
                                                })
                                                .map((r) => (
                                                    <Table.Row key={`relink-${r.contifico_id}`} className="bg-ui-bg-subtle">
                                                        <Table.Cell>
                                                            <ContificoCell
                                                                nombre={r.contifico_nombre}
                                                                codigo={r.contifico_codigo}
                                                                currentMedusaTitle={r.current_medusa_title}
                                                            />
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <MedusaSelect
                                                                value={manualSelections[r.contifico_id] || r.suggested_medusa_id || ""}
                                                                onChange={(val) => setManualSelections(prev => ({ ...prev, [r.contifico_id]: val }))}
                                                                options={availableMedusa}
                                                                suggestedId={r.suggested_medusa_id}
                                                                suggestedTitle={r.suggested_medusa_title}
                                                            />
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            <Badge color="orange">Duplicado</Badge>
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            <Button
                                                                size="small"
                                                                disabled={linkingId !== null}
                                                                isLoading={linkingId === r.contifico_id}
                                                                onClick={() => {
                                                                    const newMedusaId = manualSelections[r.contifico_id] || r.suggested_medusa_id
                                                                    if (newMedusaId) {
                                                                        handleRelink(r.contifico_id, newMedusaId, r.contifico_nombre)
                                                                    }
                                                                }}
                                                            >
                                                                Re-vincular
                                                            </Button>
                                                        </Table.Cell>
                                                    </Table.Row>
                                                ))}
                                    </Table.Body>
                                </Table>
                            </Container>
                        )}
                    </>
                )}


            </Container>
        </>
    )
}

export const config = defineRouteConfig({
    label: "Mapeo Productos",
})

export default ProductMatchPage
