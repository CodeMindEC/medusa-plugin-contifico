import { Badge, Button, Input, Label, Text } from "@medusajs/ui"
import type { WeightedPvpField } from "../../../../lib/contifico-config"
import type {
    WeightedPresentationProfile,
    WeightedPresentationProfileMatcher,
    WeightedPresentationProfileVariant,
} from "../../../../lib/weighted-presentation-profiles"
import type { SelectOption } from "./ui-select-field"
import { UiSelectField } from "./ui-select-field"

const MATCHER_FIELDS: Array<{
    key: keyof WeightedPresentationProfileMatcher
    label: string
    placeholder: string
}> = [
    {
        key: "category_ids",
        label: "Categorías Contífico",
        placeholder: "cat_1, cat_2",
    },
    {
        key: "brand_ids",
        label: "Marcas Contífico",
        placeholder: "brand_1, brand_2",
    },
    {
        key: "unit_ids",
        label: "Unidades Contífico",
        placeholder: "unit_1, unit_2",
    },
    {
        key: "code_prefixes",
        label: "Prefijos de código",
        placeholder: "MDR, NAR",
    },
]

function parseCommaSeparatedValues(value: string): string[] {
    return Array.from(
        new Set(
            value
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean)
        )
    )
}

function formatCommaSeparatedValues(values?: string[] | null): string {
    return Array.isArray(values) ? values.join(", ") : ""
}

function parseNumericInput(value: string): number {
    return Number(value) || 0
}

interface WeightedCreationProfilesEditorProps {
    enabled: boolean
    disabledReason: string | null
    profiles: WeightedPresentationProfile[]
    defaultProfileId: string
    profileOptions: SelectOption[]
    weightedPvpOptions: SelectOption[]
    onAddProfile: () => void
    onDefaultProfileChange: (value: string) => void
    onProfileChange: (
        profileIndex: number,
        patch: Partial<Pick<WeightedPresentationProfile, "id" | "name">>
    ) => void
    onProfileMatcherChange: (
        profileIndex: number,
        patch: Partial<WeightedPresentationProfileMatcher>
    ) => void
    onRemoveProfile: (profileIndex: number) => void
    onAddVariant: (profileIndex: number) => void
    onVariantChange: (
        profileIndex: number,
        variantIndex: number,
        patch: Partial<WeightedPresentationProfileVariant>
    ) => void
    onRemoveVariant: (profileIndex: number, variantIndex: number) => void
}

export function WeightedCreationProfilesEditor({
    enabled,
    disabledReason,
    profiles,
    defaultProfileId,
    profileOptions,
    weightedPvpOptions,
    onAddProfile,
    onDefaultProfileChange,
    onProfileChange,
    onProfileMatcherChange,
    onRemoveProfile,
    onAddVariant,
    onVariantChange,
    onRemoveVariant,
}: WeightedCreationProfilesEditorProps) {
    return (
        <div className="space-y-4 rounded-lg border border-ui-border-base p-4">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <Text weight="plus">Perfiles de presentación</Text>
                    <Text className="text-ui-fg-subtle text-sm">
                        Define qué variantes debe crear Medusa para cada
                        producto weighted y cómo seleccionar ese perfil.
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
                    onClick={onAddProfile}
                    disabled={!enabled}
                >
                    Agregar perfil
                </Button>
            </div>
            <div className="max-w-sm">
                <Label>Perfil por defecto</Label>
                <UiSelectField
                    value={defaultProfileId}
                    onValueChange={onDefaultProfileChange}
                    options={profileOptions}
                    placeholder="Opcional"
                    disabled={!enabled || profiles.length === 0}
                />
                <Text className="text-ui-fg-subtle text-xs mt-2">
                    Se usa cuando ningún perfil coincide por categoría, marca,
                    unidad o prefijo de código.
                </Text>
            </div>
            {profiles.length === 0 ? (
                <Text className="text-ui-fg-subtle text-sm">
                    No hay perfiles configurados. En este modo, los productos
                    weighted sin match quedarán en revisión manual.
                </Text>
            ) : (
                <div className="space-y-4">
                    {profiles.map((profile, profileIndex) => (
                        <div
                            key={`${profile.id}-${profileIndex}`}
                            className="space-y-4 rounded-md border border-ui-border-base p-4"
                        >
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                    <Text weight="plus">{profile.name}</Text>
                                    {defaultProfileId === profile.id && (
                                        <Badge color="green">
                                            Predeterminado
                                        </Badge>
                                    )}
                                </div>
                                <Button
                                    variant="secondary"
                                    size="small"
                                    onClick={() => onRemoveProfile(profileIndex)}
                                    disabled={!enabled}
                                >
                                    Quitar perfil
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div>
                                    <Label>Nombre</Label>
                                    <Input
                                        value={profile.name}
                                        onChange={(event) =>
                                            onProfileChange(profileIndex, {
                                                name: event.target.value,
                                            })
                                        }
                                        disabled={!enabled}
                                    />
                                </div>
                                <div>
                                    <Label>ID técnico</Label>
                                    <Input
                                        value={profile.id}
                                        onChange={(event) =>
                                            onProfileChange(profileIndex, {
                                                id: event.target.value,
                                            })
                                        }
                                        disabled={!enabled}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {MATCHER_FIELDS.map((field) => (
                                    <div key={field.key}>
                                        <Label>{field.label}</Label>
                                        <Input
                                            value={formatCommaSeparatedValues(
                                                profile.matcher?.[field.key]
                                            )}
                                            onChange={(event) =>
                                                onProfileMatcherChange(
                                                    profileIndex,
                                                    {
                                                        [field.key]:
                                                            parseCommaSeparatedValues(
                                                                event.target
                                                                    .value
                                                            ),
                                                    }
                                                )
                                            }
                                            disabled={!enabled}
                                            placeholder={field.placeholder}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <Text weight="plus">
                                            Presentaciones
                                        </Text>
                                        <Text className="text-ui-fg-subtle text-sm">
                                            Cada fila crea una variante con su
                                            peso y campo PVP oficial.
                                        </Text>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        onClick={() =>
                                            onAddVariant(profileIndex)
                                        }
                                        disabled={!enabled}
                                    >
                                        Agregar presentación
                                    </Button>
                                </div>
                                {profile.variants.length === 0 ? (
                                    <Text className="text-ui-fg-subtle text-sm">
                                        Este perfil no tiene presentaciones y
                                        no podrá crear productos.
                                    </Text>
                                ) : (
                                    <div className="space-y-2">
                                        {profile.variants.map(
                                            (variant, variantIndex) => (
                                                <WeightedProfileVariantRow
                                                    key={`${profile.id}-${variantIndex}`}
                                                    enabled={enabled}
                                                    profileIndex={profileIndex}
                                                    variant={variant}
                                                    variantIndex={variantIndex}
                                                    weightedPvpOptions={
                                                        weightedPvpOptions
                                                    }
                                                    onChange={onVariantChange}
                                                    onRemove={
                                                        onRemoveVariant
                                                    }
                                                />
                                            )
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function WeightedProfileVariantRow({
    enabled,
    profileIndex,
    variant,
    variantIndex,
    weightedPvpOptions,
    onChange,
    onRemove,
}: {
    enabled: boolean
    profileIndex: number
    variant: WeightedPresentationProfileVariant
    variantIndex: number
    weightedPvpOptions: SelectOption[]
    onChange: (
        profileIndex: number,
        variantIndex: number,
        patch: Partial<WeightedPresentationProfileVariant>
    ) => void
    onRemove: (profileIndex: number, variantIndex: number) => void
}) {
    return (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[120px_160px_1fr_180px_auto]">
            <Input
                type="number"
                min={1}
                value={variant.grams}
                onChange={(event) =>
                    onChange(profileIndex, variantIndex, {
                        grams: parseNumericInput(event.target.value),
                    })
                }
                disabled={!enabled}
            />
            <UiSelectField
                value={variant.pvp_field}
                onValueChange={(value) =>
                    onChange(profileIndex, variantIndex, {
                        pvp_field: value as WeightedPvpField,
                    })
                }
                options={weightedPvpOptions}
                placeholder="Campo PVP"
                disabled={!enabled}
            />
            <Input
                value={variant.label || ""}
                onChange={(event) =>
                    onChange(profileIndex, variantIndex, {
                        label: event.target.value,
                    })
                }
                disabled={!enabled}
                placeholder="Etiqueta visible"
            />
            <Input
                value={variant.sku_suffix || ""}
                onChange={(event) =>
                    onChange(profileIndex, variantIndex, {
                        sku_suffix: event.target.value,
                    })
                }
                disabled={!enabled}
                placeholder="Sufijo SKU"
            />
            <Button
                variant="secondary"
                size="small"
                onClick={() => onRemove(profileIndex, variantIndex)}
                disabled={!enabled}
            >
                Quitar
            </Button>
        </div>
    )
}
