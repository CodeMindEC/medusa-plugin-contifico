import { Switch, Text } from "@medusajs/ui"
import type { ResolvedConfigGate } from "../../../../lib/config-gates"
import type { ContificoSettingsController } from "../state"
import { UiSelectField } from "./ui-select-field"
import { WeightedCreationProfilesEditor } from "./weighted-creation-profiles-editor"
import { WeightedPvpRulesEditor } from "./weighted-pvp-rules-editor"

type WeightedSettingsController = Pick<
    ContificoSettingsController,
    | "handleAddWeightedCreationProfile"
    | "handleAddWeightedCreationVariant"
    | "handleAddWeightedRule"
    | "handleRemoveWeightedCreationProfile"
    | "handleRemoveWeightedCreationVariant"
    | "handleRemoveWeightedRule"
    | "handleWeightedCreationModeChange"
    | "handleWeightedCreationProfileChange"
    | "handleWeightedCreationProfileMatcherChange"
    | "handleWeightedCreationVariantChange"
    | "handleWeightedDefaultProfileChange"
    | "handleWeightedPvpFieldChange"
    | "handleWeightedPriceSyncChange"
    | "handleWeightedPricingStrategyChange"
    | "handleWeightedRuleChange"
    | "parsedAdvancedSettings"
    | "weightedCreationMode"
    | "weightedCreationModeGate"
    | "weightedCreationModeOptions"
    | "weightedCreationProfileOptions"
    | "weightedCreationProfiles"
    | "weightedCreationProfilesGate"
    | "weightedDefaultProfileId"
    | "weightedFallbackField"
    | "weightedFixedFieldGate"
    | "weightedPriceLockGate"
    | "weightedPriceStrategy"
    | "weightedPriceStrategyOptions"
    | "weightedPvpOptions"
    | "weightedPvpRules"
    | "weightedRulesGate"
    | "weightedStrategyGate"
>

function renderGateReason(gate: ResolvedConfigGate) {
    return !gate.enabled && gate.disabledReason ? (
        <Text className="text-ui-fg-destructive text-xs mt-1">
            {gate.disabledReason}
        </Text>
    ) : null
}

export function WeightedSettingsPanel({
    controller,
}: {
    controller: WeightedSettingsController
}) {
    const {
        handleAddWeightedCreationProfile,
        handleAddWeightedCreationVariant,
        handleAddWeightedRule,
        handleRemoveWeightedCreationProfile,
        handleRemoveWeightedCreationVariant,
        handleRemoveWeightedRule,
        handleWeightedCreationModeChange,
        handleWeightedCreationProfileChange,
        handleWeightedCreationProfileMatcherChange,
        handleWeightedCreationVariantChange,
        handleWeightedDefaultProfileChange,
        handleWeightedPvpFieldChange,
        handleWeightedPriceSyncChange,
        handleWeightedPricingStrategyChange,
        handleWeightedRuleChange,
        parsedAdvancedSettings,
        weightedCreationMode,
        weightedCreationModeGate,
        weightedCreationModeOptions,
        weightedCreationProfileOptions,
        weightedCreationProfiles,
        weightedCreationProfilesGate,
        weightedDefaultProfileId,
        weightedFallbackField,
        weightedFixedFieldGate,
        weightedPriceLockGate,
        weightedPriceStrategy,
        weightedPriceStrategyOptions,
        weightedPvpOptions,
        weightedPvpRules,
        weightedRulesGate,
        weightedStrategyGate,
    } = controller

    return (
        <>
            <div className="flex items-center justify-between">
                <div>
                    <Text weight="plus">Estrategia de precio weighted</Text>
                    <Text className="text-ui-fg-subtle text-sm">
                        Define cómo se resuelve el campo PVP para productos
                        base por peso.
                    </Text>
                    {renderGateReason(weightedStrategyGate)}
                </div>
                <UiSelectField
                    value={weightedPriceStrategy}
                    onValueChange={handleWeightedPricingStrategyChange}
                    options={weightedPriceStrategyOptions}
                    placeholder="Estrategia weighted"
                    triggerClassName="w-[220px]"
                    disabled={!weightedStrategyGate.enabled}
                />
            </div>
            <div className="flex items-center justify-between">
                <div>
                    <Text weight="plus">Creación automática weighted</Text>
                    <Text className="text-ui-fg-subtle text-sm">
                        Decide si los productos base por peso sin match se crean
                        automáticamente o quedan en revisión manual.
                    </Text>
                    {renderGateReason(weightedCreationModeGate)}
                </div>
                <UiSelectField
                    value={weightedCreationMode}
                    onValueChange={handleWeightedCreationModeChange}
                    options={weightedCreationModeOptions}
                    placeholder="Creación weighted"
                    triggerClassName="w-[240px]"
                    disabled={!weightedCreationModeGate.enabled}
                />
            </div>
            {weightedCreationProfilesGate.visible && (
                <WeightedCreationProfilesEditor
                    enabled={weightedCreationProfilesGate.enabled}
                    disabledReason={weightedCreationProfilesGate.disabledReason}
                    profiles={weightedCreationProfiles}
                    defaultProfileId={weightedDefaultProfileId}
                    profileOptions={weightedCreationProfileOptions}
                    weightedPvpOptions={weightedPvpOptions}
                    onAddProfile={handleAddWeightedCreationProfile}
                    onDefaultProfileChange={handleWeightedDefaultProfileChange}
                    onProfileChange={handleWeightedCreationProfileChange}
                    onProfileMatcherChange={
                        handleWeightedCreationProfileMatcherChange
                    }
                    onRemoveProfile={handleRemoveWeightedCreationProfile}
                    onAddVariant={handleAddWeightedCreationVariant}
                    onVariantChange={handleWeightedCreationVariantChange}
                    onRemoveVariant={handleRemoveWeightedCreationVariant}
                />
            )}
            {weightedFixedFieldGate.visible && (
                <div className="flex items-center justify-between">
                    <div>
                        <Text weight="plus">
                            {weightedPriceStrategy === "rules_by_weight"
                                ? "PVP de fallback"
                                : "PVP por defecto"}
                        </Text>
                        <Text className="text-ui-fg-subtle text-sm">
                            {weightedPriceStrategy === "rules_by_weight"
                                ? "Se usa cuando no existe una regla que coincida con el peso de la variante."
                                : "Usado por el modo por peso para calcular el precio por gramo."}{" "}
                            Usa <code>variant.weight</code> en gramos y permite
                            override con
                            <code> variant.metadata.contifico_weight_grams</code>.
                        </Text>
                        {renderGateReason(weightedFixedFieldGate)}
                    </div>
                    <UiSelectField
                        value={weightedFallbackField}
                        onValueChange={handleWeightedPvpFieldChange}
                        options={weightedPvpOptions}
                        placeholder="PVP por defecto"
                        triggerClassName="w-[220px]"
                        disabled={!weightedFixedFieldGate.enabled}
                    />
                </div>
            )}
            {weightedRulesGate.visible && (
                <WeightedPvpRulesEditor
                    enabled={weightedRulesGate.enabled}
                    disabledReason={weightedRulesGate.disabledReason}
                    rules={weightedPvpRules}
                    weightedPvpOptions={weightedPvpOptions}
                    onAddRule={handleAddWeightedRule}
                    onRuleChange={handleWeightedRuleChange}
                    onRemoveRule={handleRemoveWeightedRule}
                />
            )}
            <div className="flex items-center justify-between">
                <div>
                    <Text weight="plus">
                        Bloquear precio por peso a Contífico
                    </Text>
                    <Text className="text-ui-fg-subtle text-sm">
                        Cuando está activo, los productos weighted toman a
                        Contífico como precio oficial. Puedes desactivarlo
                        globalmente o por producto.
                    </Text>
                    {renderGateReason(weightedPriceLockGate)}
                </div>
                <Switch
                    checked={
                        parsedAdvancedSettings?.weighted
                            .allow_weighted_price_sync ?? false
                    }
                    onCheckedChange={handleWeightedPriceSyncChange}
                    disabled={!weightedPriceLockGate.enabled}
                />
            </div>
        </>
    )
}
