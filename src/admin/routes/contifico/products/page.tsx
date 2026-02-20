import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
    Container,
    Heading,
    Button,
    Text,
    Badge,
    Table,
    Checkbox,
    Toaster,
    toast,
    Input,
} from "@medusajs/ui"
import { ArrowUturnLeft, XMark } from "@medusajs/icons"
import { useState, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────

interface ProductMatch {
    contifico_id: string
    contifico_nombre: string
    contifico_codigo: string
    medusa_id: string
    medusa_title: string
    medusa_sku: string | null
    similarity: number
    match_type: "exact_sku" | "exact_name" | "similar" | "barcode"
}

interface LinkedProduct {
    map_id: string
    contifico_id: string
    contifico_nombre: string
    contifico_codigo: string
    medusa_id: string
    medusa_title: string
    medusa_sku: string | null
    created_by_plugin: boolean
    auto_linked: boolean
    match_type: string | null
}

interface UnlinkedContifico {
    contifico_id: string
    contifico_nombre: string
    contifico_codigo: string
}

interface UnlinkedMedusa {
    medusa_id: string
    medusa_title: string
    medusa_sku: string | null
}

interface LinkStats {
    total_linked: number
    total_unlinked_contifico: number
    total_unlinked_medusa: number
    contifico_total: number
    medusa_total: number
}

interface MatchStats {
    contifico_total: number
    medusa_total: number
    already_linked: number
    exact_sku: number
    exact_name: number
    barcode: number
    similar: number
    unmatched_contifico: number
}

// ── Helpers ────────────────────────────────────────────────

const matchTypeLabel: Record<string, string> = {
    exact_sku: "SKU exacto",
    exact_name: "Nombre exacto",
    barcode: "Cod. barras",
    similar: "Similar",
    sku: "SKU",
    name: "Nombre",
}

const matchTypeColor: Record<string, "green" | "blue" | "purple" | "orange"> = {
    exact_sku: "green",
    exact_name: "blue",
    barcode: "purple",
    similar: "orange",
    sku: "green",
    name: "blue",
}

function similarityBadge(score: number) {
    if (score >= 0.9) return <Badge color="green">{(score * 100).toFixed(0)}%</Badge>
    if (score >= 0.7) return <Badge color="blue">{(score * 100).toFixed(0)}%</Badge>
    if (score >= 0.5) return <Badge color="orange">{(score * 100).toFixed(0)}%</Badge>
    return <Badge color="red">{(score * 100).toFixed(0)}%</Badge>
}

type TabId = "linked" | "suggestions" | "unlinked"

// ── Component ──────────────────────────────────────────────

const ProductMatchPage = () => {
    const [activeTab, setActiveTab] = useState<TabId>("linked")

    // Linked state
    const [linked, setLinked] = useState<LinkedProduct[]>([])
    const [unlinkedContifico, setUnlinkedContifico] = useState<UnlinkedContifico[]>([])
    const [unlinkedMedusa, setUnlinkedMedusa] = useState<UnlinkedMedusa[]>([])
    const [linkStats, setLinkStats] = useState<LinkStats | null>(null)
    const [isLoadingLinked, setIsLoadingLinked] = useState(false)
    const [linkedFilter, setLinkedFilter] = useState("")
    const [unlinkedFilter, setUnlinkedFilter] = useState("")

    // Match/suggestions state
    const [matches, setMatches] = useState<ProductMatch[]>([])
    const [matchStats, setMatchStats] = useState<MatchStats | null>(null)
    const [isLoadingMatches, setIsLoadingMatches] = useState(false)
    const [isLinking, setIsLinking] = useState(false)
    const [isUnlinking, setIsUnlinking] = useState(false)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [hasLoadedMatches, setHasLoadedMatches] = useState(false)
    const [hasLoadedLinked, setHasLoadedLinked] = useState(false)

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
            setUnlinkedContifico(data.unlinked_contifico || [])
            setUnlinkedMedusa(data.unlinked_medusa || [])
            setLinkStats(data.stats || null)
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
        setSelected(new Set())
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
            setMatchStats(data.stats || null)
            setHasLoadedMatches(true)
        } catch (err) {
            toast.error("Error", { description: (err as Error).message })
        } finally {
            setIsLoadingMatches(false)
        }
    }, [])

    // ── Selection helpers ──
    const toggleSelect = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }
    const selectAll = () => setSelected(new Set(matches.map((m) => m.contifico_id)))
    const selectNone = () => setSelected(new Set())
    const selectByType = (type: string) =>
        setSelected(new Set(matches.filter((m) => m.match_type === type).map((m) => m.contifico_id)))
    const selectHighConfidence = () =>
        setSelected(new Set(matches.filter((m) => m.similarity >= 0.75).map((m) => m.contifico_id)))

    // ── Link selected ──
    const handleLink = async () => {
        if (selected.size === 0) return
        setIsLinking(true)
        try {
            const links = matches
                .filter((m) => selected.has(m.contifico_id))
                .map((m) => ({
                    contifico_id: m.contifico_id,
                    medusa_id: m.medusa_id,
                    contifico_codigo: m.contifico_codigo,
                }))

            const res = await fetch("/admin/contifico/products/link", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ links }),
            })
            const data = await res.json()
            if (data.error) {
                toast.error("Error", { description: data.error })
                return
            }
            toast.success("Productos vinculados", {
                description: `${data.linked} vinculado(s), ${data.skipped} omitido(s)`,
            })
            setMatches((prev) => prev.filter((m) => !selected.has(m.contifico_id)))
            setSelected(new Set())
            if (matchStats) {
                setMatchStats({ ...matchStats, already_linked: matchStats.already_linked + data.linked })
            }
            // Invalidar datos de vinculados para que se recarguen
            setHasLoadedLinked(false)
        } catch (err) {
            toast.error("Error", { description: (err as Error).message })
        } finally {
            setIsLinking(false)
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

    const filteredUnlinkedContifico = unlinkedContifico.filter((u) => {
        if (!unlinkedFilter) return true
        const q = unlinkedFilter.toLowerCase()
        return (
            u.contifico_nombre.toLowerCase().includes(q) ||
            u.contifico_codigo.toLowerCase().includes(q)
        )
    })

    const filteredUnlinkedMedusa = unlinkedMedusa.filter((u) => {
        if (!unlinkedFilter) return true
        const q = unlinkedFilter.toLowerCase()
        return (
            u.medusa_title.toLowerCase().includes(q) ||
            (u.medusa_sku && u.medusa_sku.toLowerCase().includes(q))
        )
    })

    // ── Tabs ──
    const tabs: Array<{ id: TabId; label: string; count?: number }> = [
        { id: "linked", label: "Vinculados", count: linkStats?.total_linked },
        { id: "suggestions", label: "Sugerencias", count: hasLoadedMatches ? matches.length : undefined },
        { id: "unlinked", label: "Sin vincular", count: linkStats ? linkStats.total_unlinked_contifico + linkStats.total_unlinked_medusa : undefined },
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
                                if (tab.id === "unlinked" && !hasLoadedLinked) fetchLinked()
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
                                    <div className="grid grid-cols-3 gap-4 mb-4">
                                        <Container className="p-4 text-center">
                                            <Text className="text-ui-fg-subtle text-xs">Vinculados</Text>
                                            <Text weight="plus" className="text-xl text-ui-fg-positive">{linkStats.total_linked}</Text>
                                        </Container>
                                        <Container className="p-4 text-center">
                                            <Text className="text-ui-fg-subtle text-xs">Contifico total</Text>
                                            <Text weight="plus" className="text-xl">{linkStats.contifico_total}</Text>
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
                                                    <Table.HeaderCell className="w-16"></Table.HeaderCell>
                                                </Table.Row>
                                            </Table.Header>
                                            <Table.Body>
                                                {filteredLinked.map((l) => (
                                                    <Table.Row key={l.map_id}>
                                                        <Table.Cell>
                                                            <div>
                                                                <Text weight="plus" className="text-sm">{l.contifico_nombre}</Text>
                                                                <Text className="text-xs text-ui-fg-subtle">Cod: {l.contifico_codigo}</Text>
                                                            </div>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <div>
                                                                <Text weight="plus" className="text-sm">{l.medusa_title}</Text>
                                                                {l.medusa_sku && (
                                                                    <Text className="text-xs text-ui-fg-subtle">SKU: {l.medusa_sku}</Text>
                                                                )}
                                                            </div>
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            {l.match_type && (
                                                                <Badge color={matchTypeColor[l.match_type] || "grey"}>
                                                                    {matchTypeLabel[l.match_type] || l.match_type}
                                                                </Badge>
                                                            )}
                                                        </Table.Cell>
                                                        <Table.Cell className="text-center">
                                                            <Badge color={l.created_by_plugin ? "blue" : l.auto_linked ? "purple" : "grey"}>
                                                                {l.created_by_plugin ? "Plugin" : l.auto_linked ? "Auto" : "Manual"}
                                                            </Badge>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <button
                                                                onClick={() => handleUnlink(l.medusa_id, l.contifico_nombre)}
                                                                disabled={isUnlinking}
                                                                className="text-ui-fg-subtle hover:text-ui-fg-destructive transition-colors p-1"
                                                                title="Desvincular"
                                                            >
                                                                <XMark />
                                                            </button>
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

                {/* ═══════════ TAB: SUGERENCIAS ═══════════ */}
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
                                </div>
                            </Container>
                        )}

                        {/* Actions bar */}
                        {matches.length > 0 && (
                            <Container className="mb-4 p-4">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Text className="text-sm text-ui-fg-subtle">Seleccionar:</Text>
                                        <Button variant="secondary" size="small" onClick={selectAll}>Todos ({matches.length})</Button>
                                        <Button variant="secondary" size="small" onClick={selectHighConfidence}>Alta confianza (≥75%)</Button>
                                        <Button variant="secondary" size="small" onClick={() => selectByType("exact_sku")}>Solo SKU exacto</Button>
                                        <Button variant="secondary" size="small" onClick={() => selectByType("exact_name")}>Solo nombre exacto</Button>
                                        <Button variant="secondary" size="small" onClick={selectNone}>Ninguno</Button>
                                    </div>
                                    <Button onClick={handleLink} disabled={selected.size === 0 || isLinking} isLoading={isLinking}>
                                        Vincular {selected.size} producto(s)
                                    </Button>
                                </div>
                            </Container>
                        )}

                        {/* Results */}
                        {!hasLoadedMatches ? (
                            <Container className="p-8 text-center">
                                <Text className="text-ui-fg-subtle">
                                    Haz clic en "Analizar Productos" para buscar coincidencias entre Contifico y Medusa.
                                </Text>
                            </Container>
                        ) : matches.length === 0 ? (
                            <Container className="p-8 text-center">
                                <Text className="text-ui-fg-subtle">
                                    No se encontraron matches pendientes.
                                    {matchStats && matchStats.already_linked > 0 ? ` Ya hay ${matchStats.already_linked} producto(s) vinculado(s).` : ""}
                                </Text>
                            </Container>
                        ) : (
                            <Container className="p-0 overflow-x-auto">
                                <Table>
                                    <Table.Header>
                                        <Table.Row>
                                            <Table.HeaderCell className="w-10">
                                                <Checkbox
                                                    checked={selected.size === matches.length && matches.length > 0}
                                                    onCheckedChange={(checked) => (checked ? selectAll() : selectNone())}
                                                />
                                            </Table.HeaderCell>
                                            <Table.HeaderCell>Contifico</Table.HeaderCell>
                                            <Table.HeaderCell>Medusa</Table.HeaderCell>
                                            <Table.HeaderCell className="w-28 text-center">Similitud</Table.HeaderCell>
                                            <Table.HeaderCell className="w-28 text-center">Tipo</Table.HeaderCell>
                                        </Table.Row>
                                    </Table.Header>
                                    <Table.Body>
                                        {matches.map((m) => (
                                            <Table.Row key={m.contifico_id} className={selected.has(m.contifico_id) ? "bg-ui-bg-highlight" : ""}>
                                                <Table.Cell>
                                                    <Checkbox checked={selected.has(m.contifico_id)} onCheckedChange={() => toggleSelect(m.contifico_id)} />
                                                </Table.Cell>
                                                <Table.Cell>
                                                    <div>
                                                        <Text weight="plus" className="text-sm">{m.contifico_nombre}</Text>
                                                        <Text className="text-xs text-ui-fg-subtle">Cod: {m.contifico_codigo}</Text>
                                                    </div>
                                                </Table.Cell>
                                                <Table.Cell>
                                                    <div>
                                                        <Text weight="plus" className="text-sm">{m.medusa_title}</Text>
                                                        {m.medusa_sku && <Text className="text-xs text-ui-fg-subtle">SKU: {m.medusa_sku}</Text>}
                                                    </div>
                                                </Table.Cell>
                                                <Table.Cell className="text-center">{similarityBadge(m.similarity)}</Table.Cell>
                                                <Table.Cell className="text-center">
                                                    <Badge color={matchTypeColor[m.match_type]}>{matchTypeLabel[m.match_type]}</Badge>
                                                </Table.Cell>
                                            </Table.Row>
                                        ))}
                                    </Table.Body>
                                </Table>
                            </Container>
                        )}
                    </>
                )}

                {/* ═══════════ TAB: SIN VINCULAR ═══════════ */}
                {activeTab === "unlinked" && (
                    <>
                        {!hasLoadedLinked ? (
                            <Container className="p-8 text-center">
                                <Button onClick={fetchLinked} isLoading={isLoadingLinked}>
                                    Cargar productos
                                </Button>
                            </Container>
                        ) : (
                            <>
                                <div className="flex items-center gap-3 mb-4">
                                    <Input
                                        placeholder="Filtrar por nombre, código o SKU..."
                                        value={unlinkedFilter}
                                        onChange={(e) => setUnlinkedFilter(e.target.value)}
                                        className="max-w-sm"
                                    />
                                    <Button variant="secondary" size="small" onClick={fetchLinked} isLoading={isLoadingLinked}>
                                        Recargar
                                    </Button>
                                </div>

                                {/* Unlinked Contifico */}
                                <Container className="mb-6 p-4">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Heading level="h2">En Contifico sin vínculo</Heading>
                                        <Badge color="orange">{filteredUnlinkedContifico.length}</Badge>
                                    </div>
                                    <Text className="text-ui-fg-subtle text-sm mb-3">
                                        Productos activos en Contifico que no están vinculados a ningún producto de Medusa.
                                        Usa la pestaña "Sugerencias" para vincularlos automáticamente.
                                    </Text>
                                    {filteredUnlinkedContifico.length === 0 ? (
                                        <Text className="text-ui-fg-subtle text-sm">
                                            {unlinkedFilter ? "Sin resultados." : "Todos los productos de Contifico están vinculados. ✓"}
                                        </Text>
                                    ) : (
                                        <div className="max-h-80 overflow-y-auto">
                                            <Table>
                                                <Table.Header>
                                                    <Table.Row>
                                                        <Table.HeaderCell>Nombre</Table.HeaderCell>
                                                        <Table.HeaderCell className="w-32">Código</Table.HeaderCell>
                                                    </Table.Row>
                                                </Table.Header>
                                                <Table.Body>
                                                    {filteredUnlinkedContifico.map((u) => (
                                                        <Table.Row key={u.contifico_id}>
                                                            <Table.Cell>
                                                                <Text className="text-sm">{u.contifico_nombre}</Text>
                                                            </Table.Cell>
                                                            <Table.Cell>
                                                                <Text className="text-sm text-ui-fg-subtle">{u.contifico_codigo}</Text>
                                                            </Table.Cell>
                                                        </Table.Row>
                                                    ))}
                                                </Table.Body>
                                            </Table>
                                        </div>
                                    )}
                                </Container>

                                {/* Unlinked Medusa */}
                                <Container className="p-4">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Heading level="h2">En Medusa sin vínculo</Heading>
                                        <Badge color="blue">{filteredUnlinkedMedusa.length}</Badge>
                                    </div>
                                    <Text className="text-ui-fg-subtle text-sm mb-3">
                                        Productos en Medusa que no están vinculados a ningún producto de Contifico.
                                    </Text>
                                    {filteredUnlinkedMedusa.length === 0 ? (
                                        <Text className="text-ui-fg-subtle text-sm">
                                            {unlinkedFilter ? "Sin resultados." : "Todos los productos de Medusa están vinculados. ✓"}
                                        </Text>
                                    ) : (
                                        <div className="max-h-80 overflow-y-auto">
                                            <Table>
                                                <Table.Header>
                                                    <Table.Row>
                                                        <Table.HeaderCell>Nombre</Table.HeaderCell>
                                                        <Table.HeaderCell className="w-32">SKU</Table.HeaderCell>
                                                    </Table.Row>
                                                </Table.Header>
                                                <Table.Body>
                                                    {filteredUnlinkedMedusa.map((u) => (
                                                        <Table.Row key={u.medusa_id}>
                                                            <Table.Cell>
                                                                <Text className="text-sm">{u.medusa_title}</Text>
                                                            </Table.Cell>
                                                            <Table.Cell>
                                                                <Text className="text-sm text-ui-fg-subtle">{u.medusa_sku || "—"}</Text>
                                                            </Table.Cell>
                                                        </Table.Row>
                                                    ))}
                                                </Table.Body>
                                            </Table>
                                        </div>
                                    )}
                                </Container>
                            </>
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
