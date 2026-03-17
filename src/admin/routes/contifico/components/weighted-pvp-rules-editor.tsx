import { Button, Input, Text } from "@medusajs/ui"
import type { WeightedPvpField } from "../../../../lib/contifico-config"
import type { WeightedPvpByGramsRule } from "../../../../lib/weighted-price-strategies"
import type { SelectOption } from "./ui-select-field"
import { UiSelectField } from "./ui-select-field"

interface WeightedPvpRulesEditorProps {
    enabled: boolean
    disabledReason: string | null
    rules: WeightedPvpByGramsRule[]
    weightedPvpOptions: SelectOption[]
    onAddRule: () => void
    onRuleChange: (
        index: number,
        patch: Partial<WeightedPvpByGramsRule>
    ) => void
    onRemoveRule: (index: number) => void
}

export function WeightedPvpRulesEditor({
    enabled,
    disabledReason,
    rules,
    weightedPvpOptions,
    onAddRule,
    onRuleChange,
    onRemoveRule,
}: WeightedPvpRulesEditorProps) {
    return (
        <div className="space-y-3 rounded-lg border border-ui-border-base p-4">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <Text weight="plus">Reglas por peso</Text>
                    <Text className="text-ui-fg-subtle text-sm">
                        Relaciona gramajes exactos con el campo PVP que debe
                        usar la estrategia.
                    </Text>
                    {!enabled && disabledReason && (
                        <Text className="text-ui-fg-destructive text-xs mt-1">
                            {disabledReason}
                        </Text>
                    )}
                </div>
                <Button
                    variant="secondary"
                    size="small"
                    onClick={onAddRule}
                    disabled={!enabled}
                >
                    Agregar regla
                </Button>
            </div>
            {rules.length === 0 ? (
                <Text className="text-ui-fg-subtle text-sm">
                    No hay reglas cargadas. Se usará el PVP de fallback.
                </Text>
            ) : (
                <div className="space-y-2">
                    {rules.map((rule, index) => (
                        <div
                            key={`${rule.grams}-${rule.field}-${index}`}
                            className="grid grid-cols-1 gap-2 md:grid-cols-[140px_180px_auto]"
                        >
                            <Input
                                type="number"
                                min={1}
                                value={rule.grams}
                                onChange={(event) =>
                                    onRuleChange(index, {
                                        grams:
                                            Number(event.target.value) || 0,
                                    })
                                }
                                disabled={!enabled}
                            />
                            <UiSelectField
                                value={rule.field}
                                onValueChange={(value) =>
                                    onRuleChange(index, {
                                        field: value as WeightedPvpField,
                                    })
                                }
                                options={weightedPvpOptions}
                                placeholder="Campo PVP"
                                disabled={!enabled}
                            />
                            <Button
                                variant="secondary"
                                size="small"
                                onClick={() => onRemoveRule(index)}
                                disabled={!enabled}
                            >
                                Quitar
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
