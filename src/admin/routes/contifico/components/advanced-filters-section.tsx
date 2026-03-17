import {
    Button,
    Container,
    Heading,
    Input,
    Text,
} from "@medusajs/ui"
import {
    describeImportFilterRule,
    FILTERABLE_FIELDS,
    FILTER_OPERATORS,
    type FilterOperator,
} from "../../../../lib/contifico-filters"
import type { ContificoSettingsController } from "../state"
import { UiSelectField } from "./ui-select-field"

export function AdvancedFiltersSection({
    controller,
}: {
    controller: ContificoSettingsController
}) {
    const {
        advancedSettingsJson,
        applyAdvancedProfile,
        filterMode,
        filterRules,
        removeImportFilterRule,
        setAdvancedSettingsJson,
        setFilterMode,
        updateImportFilterRule,
    } = controller

    return (
        <>
            <Container className="mb-6 p-6">
                <Heading level="h2" className="mb-2">
                    Configuración avanzada
                </Heading>
                <Text className="text-ui-fg-subtle text-sm mb-4">
                    Define políticas de matching, pricing, stock, facturación,
                    borrado y comportamiento de sync. Se guarda como esquema
                    versionado y sigue siendo compatible con la configuración básica.
                </Text>
                <div className="mb-3 flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="small"
                        onClick={() => applyAdvancedProfile("standard")}
                    >
                        Perfil estándar
                    </Button>
                    <Button
                        variant="secondary"
                        size="small"
                        onClick={() => applyAdvancedProfile("weighted")}
                    >
                        Perfil por peso
                    </Button>
                    <Button
                        variant="secondary"
                        size="small"
                        onClick={() => applyAdvancedProfile("manual")}
                    >
                        Perfil manual
                    </Button>
                </div>
                <textarea
                    value={advancedSettingsJson}
                    onChange={(event) => setAdvancedSettingsJson(event.target.value)}
                    className="w-full min-h-[320px] rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-2 text-xs font-mono text-ui-fg-base"
                    spellCheck={false}
                />
            </Container>

            <Container className="mb-6 p-6">
                <Heading level="h2" className="mb-2">
                    Filtros de Importación
                </Heading>
                <Text className="text-ui-fg-subtle text-sm mb-4">
                    Define reglas para filtrar qué productos se importan desde
                    Contifico. Sin filtros = se importan todos los productos activos.
                </Text>

                {filterRules.length > 0 && (
                    <div className="mb-4 flex items-center gap-3 rounded-lg bg-ui-bg-subtle p-3">
                        <Text className="text-sm" weight="plus">
                            Modo de combinación:
                        </Text>
                        <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                                type="radio"
                                name="filterMode"
                                value="and"
                                checked={filterMode === "and"}
                                onChange={() => setFilterMode("and")}
                                className="accent-ui-fg-interactive"
                            />
                            <Text className="text-sm">Todos deben cumplirse (AND)</Text>
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                                type="radio"
                                name="filterMode"
                                value="or"
                                checked={filterMode === "or"}
                                onChange={() => setFilterMode("or")}
                                className="accent-ui-fg-interactive"
                            />
                            <Text className="text-sm">Al menos uno (OR)</Text>
                        </label>
                    </div>
                )}

                <div className="space-y-3">
                    {filterRules.map((rule, index) => (
                        <div
                            key={index}
                            className="flex items-start gap-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3"
                        >
                            <div className="flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <UiSelectField
                                        value={rule.field}
                                        onValueChange={(value) =>
                                            updateImportFilterRule(index, { field: value })
                                        }
                                        options={FILTERABLE_FIELDS.map((field) => ({
                                            value: field.value,
                                            label: field.label,
                                        }))}
                                        placeholder="Campo"
                                        triggerClassName="w-[220px]"
                                    />
                                    <UiSelectField
                                        value={rule.operator}
                                        onValueChange={(value) =>
                                            updateImportFilterRule(index, {
                                                operator: value as FilterOperator,
                                            })
                                        }
                                        options={Object.entries(FILTER_OPERATORS).map(
                                            ([key, meta]) => ({
                                                value: key,
                                                label: meta.label_es,
                                            })
                                        )}
                                        placeholder="Operador"
                                        triggerClassName="w-[220px]"
                                    />
                                    {FILTER_OPERATORS[rule.operator]?.needsValue && (
                                        <Input
                                            placeholder="Valor..."
                                            value={rule.value || ""}
                                            onChange={(event) =>
                                                updateImportFilterRule(index, {
                                                    value: event.target.value,
                                                })
                                            }
                                            className="max-w-[200px]"
                                        />
                                    )}
                                </div>
                                <Text className="text-xs italic text-ui-fg-subtle">
                                    ↳ Filtra productos donde {describeImportFilterRule(rule)}
                                </Text>
                            </div>
                            <Button
                                variant="danger"
                                size="small"
                                onClick={() => removeImportFilterRule(index)}
                            >
                                ×
                            </Button>
                        </div>
                    ))}
                </div>

                <div className="mt-3">
                    <Button
                        variant="secondary"
                        size="small"
                        onClick={controller.addImportFilterRule}
                    >
                        + Agregar filtro
                    </Button>
                </div>

                {filterRules.length === 0 && (
                    <div className="mt-3 rounded-lg bg-ui-bg-subtle p-3">
                        <Text className="text-sm text-ui-fg-subtle">
                            Sin filtros configurados. Se importarán todos los productos
                            activos de Contifico.
                        </Text>
                    </div>
                )}
            </Container>
        </>
    )
}
