import { getWeightedFallbackPvpField } from "../../../lib/advanced-settings"
import type { AdvancedContificoSettings } from "../../../lib/advanced-settings"
import type { WeightedPvpField } from "../../../lib/contifico-config"
import type {
    RulesByWeightStrategyConfig,
    WeightedPriceStrategy,
} from "../../../lib/weighted-price-strategies"
import type {
    WeightedPresentationProfile,
    WeightedPresentationProfileMatcher,
    WeightedPresentationProfileVariant,
} from "../../../lib/weighted-presentation-profiles"

export interface WeightedCreationProfileState {
    creation_profiles: WeightedPresentationProfile[]
    default_profile_id: string | null
}

export function getWeightedCreationProfileState(
    settings: AdvancedContificoSettings
): WeightedCreationProfileState {
    return {
        creation_profiles: settings.weighted.creation_profiles,
        default_profile_id: settings.weighted.default_profile_id,
    }
}

export function addWeightedCreationProfileState(
    state: WeightedCreationProfileState,
    fallbackField: WeightedPvpField
): WeightedCreationProfileState {
    const nextIndex = state.creation_profiles.length + 1
    const nextProfile = createWeightedCreationProfile(nextIndex, fallbackField)

    return {
        creation_profiles: [...state.creation_profiles, nextProfile],
        default_profile_id: state.default_profile_id || nextProfile.id,
    }
}

export function removeWeightedCreationProfileState(
    state: WeightedCreationProfileState,
    profileIndex: number
): WeightedCreationProfileState {
    const removedProfile = state.creation_profiles[profileIndex]

    return {
        creation_profiles: removeAtIndex(state.creation_profiles, profileIndex),
        default_profile_id:
            removedProfile && state.default_profile_id === removedProfile.id
                ? null
                : state.default_profile_id,
    }
}

export function patchWeightedCreationProfileState(
    state: WeightedCreationProfileState,
    profileIndex: number,
    patch: Partial<Pick<WeightedPresentationProfile, "id" | "name">>
): WeightedCreationProfileState {
    const previousProfile = state.creation_profiles[profileIndex]
    const nextProfiles = updateAtIndex(
        state.creation_profiles,
        profileIndex,
        (profile) => ({ ...profile, ...patch })
    )
    const nextProfileId =
        patch.id && patch.id.trim().length > 0 ? patch.id : previousProfile?.id

    return {
        creation_profiles: nextProfiles,
        default_profile_id:
            previousProfile && state.default_profile_id === previousProfile.id
                ? nextProfileId || null
                : state.default_profile_id,
    }
}

export function patchWeightedCreationProfileMatcherState(
    state: WeightedCreationProfileState,
    profileIndex: number,
    patch: Partial<WeightedPresentationProfileMatcher>
): WeightedCreationProfileState {
    return {
        ...state,
        creation_profiles: updateAtIndex(
            state.creation_profiles,
            profileIndex,
            (profile) => ({
                ...profile,
                matcher: {
                    ...(profile.matcher || {}),
                    ...patch,
                },
            })
        ),
    }
}

export function addWeightedCreationVariantState(
    state: WeightedCreationProfileState,
    profileIndex: number,
    fallbackField: WeightedPvpField
): WeightedCreationProfileState {
    return {
        ...state,
        creation_profiles: updateAtIndex(
            state.creation_profiles,
            profileIndex,
            (profile) => ({
                ...profile,
                variants: [
                    ...profile.variants,
                    createWeightedCreationVariant(fallbackField),
                ],
            })
        ),
    }
}

export function patchWeightedCreationVariantState(
    state: WeightedCreationProfileState,
    profileIndex: number,
    variantIndex: number,
    patch: Partial<WeightedPresentationProfileVariant>
): WeightedCreationProfileState {
    return {
        ...state,
        creation_profiles: updateAtIndex(
            state.creation_profiles,
            profileIndex,
            (profile) => ({
                ...profile,
                variants: updateAtIndex(
                    profile.variants,
                    variantIndex,
                    (variant) => ({ ...variant, ...patch })
                ),
            })
        ),
    }
}

export function removeWeightedCreationVariantState(
    state: WeightedCreationProfileState,
    profileIndex: number,
    variantIndex: number
): WeightedCreationProfileState {
    return {
        ...state,
        creation_profiles: updateAtIndex(
            state.creation_profiles,
            profileIndex,
            (profile) => ({
                ...profile,
                variants: removeAtIndex(profile.variants, variantIndex),
            })
        ),
    }
}

export function buildWeightedPricingStrategyConfig(
    settings: AdvancedContificoSettings,
    strategy: WeightedPriceStrategy
) {
    const fallbackField = getWeightedFallbackPvpField(settings.weighted)

    return strategy === "rules_by_weight"
        ? {
              fallback_field: fallbackField,
              rules:
                  settings.weighted.pricing_strategy === "rules_by_weight"
                      ? getWeightedRules(settings)
                      : [],
          }
        : {
              field: fallbackField,
          }
}

export function buildWeightedFallbackStrategyConfig(
    settings: AdvancedContificoSettings,
    fallbackField: WeightedPvpField
) {
    return settings.weighted.pricing_strategy === "rules_by_weight"
        ? {
              fallback_field: fallbackField,
              rules: getWeightedRules(settings),
          }
        : {
              field: fallbackField,
          }
}

export function patchWeightedRuleSet(
    settings: AdvancedContificoSettings,
    updater: (
        rules: RulesByWeightStrategyConfig["rules"]
    ) => RulesByWeightStrategyConfig["rules"]
): RulesByWeightStrategyConfig {
    return {
        fallback_field: getWeightedFallbackPvpField(settings.weighted),
        rules: updater(getWeightedRules(settings)),
    }
}

function createWeightedCreationProfile(
    nextIndex: number,
    fallbackField: WeightedPvpField
): WeightedPresentationProfile {
    return {
        id: `profile-${nextIndex}`,
        name: `Perfil ${nextIndex}`,
        matcher: null,
        variants: [createWeightedCreationVariant(fallbackField)],
    }
}

function createWeightedCreationVariant(
    fallbackField: WeightedPvpField
): WeightedPresentationProfileVariant {
    return {
        grams: 1,
        pvp_field: fallbackField,
        label: null,
        sku_suffix: null,
    }
}

function getWeightedRules(
    settings: AdvancedContificoSettings
): RulesByWeightStrategyConfig["rules"] {
    return (
        settings.weighted.strategy_config as RulesByWeightStrategyConfig
    ).rules
}

function updateAtIndex<TItem>(
    items: TItem[],
    index: number,
    updater: (item: TItem) => TItem
): TItem[] {
    return items.map((item, itemIndex) =>
        itemIndex === index ? updater(item) : item
    )
}

function removeAtIndex<TItem>(items: TItem[], index: number): TItem[] {
    return items.filter((_, itemIndex) => itemIndex !== index)
}
