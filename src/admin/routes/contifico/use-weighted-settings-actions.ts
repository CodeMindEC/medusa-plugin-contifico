import { toast } from "@medusajs/ui"
import { useCallback } from "react"
import {
    getAdvancedSettingsProfile,
    normalizeAdvancedSettings,
    type AdvancedContificoSettings,
    type AdvancedSettingsProfile,
} from "../../../lib/advanced-settings"
import type { VariantMode, WeightedPvpField } from "../../../lib/contifico-config"
import type {
    WeightedCreationMode,
    WeightedPresentationProfile,
    WeightedPresentationProfileMatcher,
    WeightedPresentationProfileVariant,
} from "../../../lib/weighted-presentation-profiles"
import type { ImportFilterRuleData } from "./types"
import type {
    RulesByWeightStrategyConfig,
    WeightedPriceStrategy,
} from "../../../lib/weighted-price-strategies"
import type { Dispatch, SetStateAction } from "react"
import {
    addWeightedCreationProfileState,
    addWeightedCreationVariantState,
    buildWeightedFallbackStrategyConfig,
    buildWeightedPricingStrategyConfig,
    getWeightedCreationProfileState,
    patchWeightedCreationProfileMatcherState,
    patchWeightedCreationProfileState,
    patchWeightedCreationVariantState,
    patchWeightedRuleSet,
    removeWeightedCreationProfileState,
    removeWeightedCreationVariantState,
    type WeightedCreationProfileState,
} from "./weighted-settings-updaters"

interface UseWeightedSettingsActionsParams {
    parsedAdvancedSettings: AdvancedContificoSettings | null
    weightedFallbackField: WeightedPvpField
    setAdvancedSettingsJson: (value: string) => void
    setFilterDateStr: (value: string) => void
    setFilterRules: Dispatch<SetStateAction<ImportFilterRuleData[]>>
    setFilterStatus: (value: string) => void
    setFilterType: (value: string) => void
    setVariantMode: (value: VariantMode) => void
    setWeightedPvpField: (value: WeightedPvpField) => void
}

export function useWeightedSettingsActions({
    parsedAdvancedSettings,
    weightedFallbackField,
    setAdvancedSettingsJson,
    setFilterDateStr,
    setFilterRules,
    setFilterStatus,
    setFilterType,
    setVariantMode,
    setWeightedPvpField,
}: UseWeightedSettingsActionsParams) {
    const applyAdvancedProfile = useCallback((profile: AdvancedSettingsProfile) => {
        setAdvancedSettingsJson(
            JSON.stringify(getAdvancedSettingsProfile(profile), null, 2)
        )
        if (profile === "weighted") {
            setVariantMode("weighted")
        }
    }, [setAdvancedSettingsJson, setVariantMode])

    const updateAdvancedSettings = useCallback(
        (
            updater: (current: AdvancedContificoSettings) => AdvancedContificoSettings,
            invalidDescription: string
        ) => {
            if (!parsedAdvancedSettings) {
                toast.error("Configuración avanzada inválida", {
                    description: invalidDescription,
                })
                return false
            }

            setAdvancedSettingsJson(
                JSON.stringify(updater(parsedAdvancedSettings), null, 2)
            )
            return true
        },
        [parsedAdvancedSettings, setAdvancedSettingsJson]
    )

    const handleWeightedPriceSyncChange = useCallback((checked: boolean) => {
        updateAdvancedSettings(
            (current) => ({
                ...current,
                weighted: {
                    ...current.weighted,
                    allow_weighted_price_sync: checked,
                },
            }),
            "Corrige el JSON antes de cambiar el bloqueo de precios."
        )
    }, [updateAdvancedSettings])

    const handleWeightedPricingStrategyChange = useCallback((value: string) => {
        updateAdvancedSettings(
            (current) =>
                normalizeAdvancedSettings({
                    ...current,
                    weighted: {
                        ...current.weighted,
                        pricing_strategy: value as WeightedPriceStrategy,
                        strategy_config: buildWeightedPricingStrategyConfig(
                            current,
                            value as WeightedPriceStrategy
                        ),
                    },
                }),
            "Corrige el JSON antes de cambiar la estrategia de precio weighted."
        )
    }, [updateAdvancedSettings])

    const handleWeightedPvpFieldChange = useCallback((value: string) => {
        const nextValue = value as WeightedPvpField
        setWeightedPvpField(nextValue)
        updateAdvancedSettings(
            (current) =>
                normalizeAdvancedSettings({
                    ...current,
                    pricing: {
                        ...current.pricing,
                        default_pvp_field: nextValue,
                    },
                    weighted: {
                        ...current.weighted,
                        strategy_config: buildWeightedFallbackStrategyConfig(
                            current,
                            nextValue
                        ),
                    },
                }),
            "Corrige el JSON antes de cambiar el PVP weighted."
        )
    }, [setWeightedPvpField, updateAdvancedSettings])

    const updateWeightedCreationProfiles = useCallback(
        (
            updater: (
                current: WeightedCreationProfileState
            ) => WeightedCreationProfileState,
            invalidDescription: string
        ) => {
            updateAdvancedSettings(
                (current) => {
                    const nextState = updater(
                        getWeightedCreationProfileState(current)
                    )

                    return normalizeAdvancedSettings({
                        ...current,
                        weighted: {
                            ...current.weighted,
                            creation_profiles: nextState.creation_profiles,
                            default_profile_id: nextState.default_profile_id,
                        },
                    })
                },
                invalidDescription
            )
        },
        [updateAdvancedSettings]
    )

    const handleWeightedCreationModeChange = useCallback((value: string) => {
        updateAdvancedSettings(
            (current) =>
                normalizeAdvancedSettings({
                    ...current,
                    weighted: {
                        ...current.weighted,
                        creation_mode: value as WeightedCreationMode,
                    },
                }),
            "Corrige el JSON antes de cambiar la creación automática weighted."
        )
    }, [updateAdvancedSettings])

    const handleWeightedDefaultProfileChange = useCallback((value: string) => {
        updateWeightedCreationProfiles(
            (current) => ({
                ...current,
                default_profile_id: !value || value === "__NONE__" ? null : value,
            }),
            "Corrige el JSON antes de cambiar el perfil weighted por defecto."
        )
    }, [updateWeightedCreationProfiles])

    const handleAddWeightedCreationProfile = useCallback(() => {
        updateWeightedCreationProfiles(
            (current) =>
                addWeightedCreationProfileState(current, weightedFallbackField),
            "Corrige el JSON antes de agregar un perfil weighted."
        )
    }, [updateWeightedCreationProfiles, weightedFallbackField])

    const handleRemoveWeightedCreationProfile = useCallback((profileIndex: number) => {
        updateWeightedCreationProfiles(
            (current) =>
                removeWeightedCreationProfileState(current, profileIndex),
            "Corrige el JSON antes de eliminar un perfil weighted."
        )
    }, [updateWeightedCreationProfiles])

    const handleWeightedCreationProfileChange = useCallback((
        profileIndex: number,
        patch: Partial<Pick<WeightedPresentationProfile, "id" | "name">>
    ) => {
        updateWeightedCreationProfiles(
            (current) =>
                patchWeightedCreationProfileState(current, profileIndex, patch),
            "Corrige el JSON antes de editar el perfil weighted."
        )
    }, [updateWeightedCreationProfiles])

    const handleWeightedCreationProfileMatcherChange = useCallback((
        profileIndex: number,
        patch: Partial<WeightedPresentationProfileMatcher>
    ) => {
        updateWeightedCreationProfiles(
            (current) =>
                patchWeightedCreationProfileMatcherState(
                    current,
                    profileIndex,
                    patch
                ),
            "Corrige el JSON antes de editar las reglas del perfil weighted."
        )
    }, [updateWeightedCreationProfiles])

    const handleAddWeightedCreationVariant = useCallback((profileIndex: number) => {
        updateWeightedCreationProfiles(
            (current) =>
                addWeightedCreationVariantState(
                    current,
                    profileIndex,
                    weightedFallbackField
                ),
            "Corrige el JSON antes de agregar una presentación weighted."
        )
    }, [updateWeightedCreationProfiles, weightedFallbackField])

    const handleWeightedCreationVariantChange = useCallback((
        profileIndex: number,
        variantIndex: number,
        patch: Partial<WeightedPresentationProfileVariant>
    ) => {
        updateWeightedCreationProfiles(
            (current) =>
                patchWeightedCreationVariantState(
                    current,
                    profileIndex,
                    variantIndex,
                    patch
                ),
            "Corrige el JSON antes de editar una presentación weighted."
        )
    }, [updateWeightedCreationProfiles])

    const handleRemoveWeightedCreationVariant = useCallback((
        profileIndex: number,
        variantIndex: number
    ) => {
        updateWeightedCreationProfiles(
            (current) =>
                removeWeightedCreationVariantState(
                    current,
                    profileIndex,
                    variantIndex
                ),
            "Corrige el JSON antes de eliminar una presentación weighted."
        )
    }, [updateWeightedCreationProfiles])

    const handleWeightedRuleChange = useCallback((
        index: number,
        patch: Partial<RulesByWeightStrategyConfig["rules"][number]>
    ) => {
        updateAdvancedSettings(
            (current) =>
                normalizeAdvancedSettings({
                    ...current,
                    weighted: {
                        ...current.weighted,
                        strategy_config: patchWeightedRuleSet(
                            current,
                            (rules) =>
                                rules.map((rule, ruleIndex) =>
                                    ruleIndex === index
                                        ? { ...rule, ...patch }
                                        : rule
                                )
                        ),
                    },
                }),
            "Corrige el JSON antes de editar reglas por peso."
        )
    }, [updateAdvancedSettings])

    const handleAddWeightedRule = useCallback(() => {
        updateAdvancedSettings(
            (current) =>
                normalizeAdvancedSettings({
                    ...current,
                    weighted: {
                        ...current.weighted,
                        strategy_config: patchWeightedRuleSet(
                            current,
                            (rules) => [
                                ...rules,
                                {
                                    grams: 1,
                                    field:
                                        weightedFallbackField,
                                },
                            ]
                        ),
                    },
                }),
            "Corrige el JSON antes de agregar reglas por peso."
        )
    }, [updateAdvancedSettings, weightedFallbackField])

    const handleRemoveWeightedRule = useCallback((index: number) => {
        updateAdvancedSettings(
            (current) =>
                normalizeAdvancedSettings({
                    ...current,
                    weighted: {
                        ...current.weighted,
                        strategy_config: patchWeightedRuleSet(
                            current,
                            (rules) =>
                                rules.filter(
                                    (_, ruleIndex) => ruleIndex !== index
                                )
                        ),
                    },
                }),
            "Corrige el JSON antes de eliminar reglas por peso."
        )
    }, [updateAdvancedSettings])

    const updateImportFilterRule = useCallback(
        (index: number, patch: Partial<ImportFilterRuleData>) => {
            setFilterRules((current) =>
                current.map((rule, ruleIndex) =>
                    ruleIndex === index ? { ...rule, ...patch } : rule
                )
            )
        },
        [setFilterRules]
    )

    const addImportFilterRule = useCallback(() => {
        setFilterRules((current) => [
            ...current,
            { field: "nombre", operator: "contains", value: "" },
        ])
    }, [setFilterRules])

    const removeImportFilterRule = useCallback((index: number) => {
        setFilterRules((current) =>
            current.filter((_, ruleIndex) => ruleIndex !== index)
        )
    }, [setFilterRules])

    const clearInvoiceFilters = useCallback(() => {
        setFilterStatus("ALL")
        setFilterType("ALL")
        setFilterDateStr("")
    }, [setFilterDateStr, setFilterStatus, setFilterType])

    return {
        addImportFilterRule,
        applyAdvancedProfile,
        clearInvoiceFilters,
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
        removeImportFilterRule,
        updateAdvancedSettings,
        updateImportFilterRule,
    }
}
