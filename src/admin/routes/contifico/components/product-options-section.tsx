import { Container, Heading, Switch, Text } from "@medusajs/ui"
import type { ReactNode } from "react"
import type { VariantMode } from "../../../../lib/contifico-config"
import type { ContificoSettingsController } from "../state"
import { UiSelectField } from "./ui-select-field"
import { WeightedSettingsPanel } from "./weighted-settings-panel"

function ProductOptionRow({
    title,
    description,
    hint,
    control,
}: {
    title: string
    description: string
    hint?: string | null
    control: ReactNode
}) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <Text weight="plus">{title}</Text>
                <Text className="text-ui-fg-subtle text-sm">{description}</Text>
                {hint ? (
                    <Text className="text-ui-fg-subtle text-xs mt-1">
                        {hint}
                    </Text>
                ) : null}
            </div>
            {control}
        </div>
    )
}

function getWeightedMappingHint(
    variantMode: VariantMode,
    weightedCreationMode: ContificoSettingsController["weightedCreationMode"]
): string | null {
    if (variantMode !== "weighted") {
        return null
    }

    return weightedCreationMode === "presentation_profile"
        ? "En modo por peso, el sync crea automáticamente solo los productos sin match que resuelven un perfil de presentación. Los demás quedan en revisión manual."
        : "En modo por peso, el sync no crea automáticamente los productos sin match. Solo actualiza los ya vinculados y deja el resto para vinculación manual."
}

export function ProductOptionsSection({
    controller,
}: {
    controller: ContificoSettingsController
}) {
    const {
        allowBackorder,
        manageInventory,
        mappingModeOptions,
        salesChannelId,
        salesChannelOptions,
        setAllowBackorder,
        setManageInventory,
        setSalesChannelId,
        setShippingProfileId,
        setVariantMode,
        shippingProfileId,
        shippingProfileOptions,
        variantMode,
        weightedCreationMode,
        weightedStrategyGate,
    } = controller
    const mappingModeValue = mappingModeOptions.some(
        (option) => option.value === variantMode
    )
        ? variantMode
        : "auto"

    return (
        <Container className="mb-6 p-6">
            <Heading level="h2" className="mb-2">
                Opciones de Productos
            </Heading>
            <Text className="text-ui-fg-subtle text-sm mb-4">
                Estas opciones se aplican a los productos creados durante la
                sincronización.
            </Text>
            <div className="space-y-4">
                <ProductOptionRow
                    title="Gestionar inventario"
                    description="Habilita el control de inventario en las variantes importadas. Si está activo, Medusa restará stock al crear pedidos."
                    control={
                        <Switch
                            checked={manageInventory}
                            onCheckedChange={setManageInventory}
                        />
                    }
                />
                <ProductOptionRow
                    title="Permitir pedidos pendientes"
                    description="Permite comprar variantes sin stock disponible (backorder)."
                    control={
                        <Switch
                            checked={allowBackorder}
                            onCheckedChange={setAllowBackorder}
                        />
                    }
                />
                <ProductOptionRow
                    title="Modo de mapeo"
                    description="Define cómo se vincula o crea el producto desde Contifico."
                    hint={getWeightedMappingHint(
                        variantMode,
                        weightedCreationMode
                    )}
                    control={
                        <UiSelectField
                            value={mappingModeValue}
                            onValueChange={(value) =>
                                setVariantMode(value as VariantMode)
                            }
                            options={mappingModeOptions}
                            placeholder="Modo de mapeo"
                            triggerClassName="w-[240px]"
                        />
                    }
                />
                {weightedStrategyGate.visible && (
                    <WeightedSettingsPanel controller={controller} />
                )}
                <ProductOptionRow
                    title="Canal de ventas"
                    description="Canal de ventas asignado a los productos sincronizados."
                    control={
                        <UiSelectField
                            value={salesChannelId}
                            onValueChange={setSalesChannelId}
                            options={salesChannelOptions}
                            placeholder="Canal de ventas"
                            triggerClassName="w-[260px]"
                        />
                    }
                />
                <ProductOptionRow
                    title="Perfil de envío"
                    description="Perfil de envío asignado a los productos sincronizados."
                    control={
                        <UiSelectField
                            value={shippingProfileId}
                            onValueChange={setShippingProfileId}
                            options={shippingProfileOptions}
                            placeholder="Perfil de envío"
                            triggerClassName="w-[260px]"
                        />
                    }
                />
            </div>
        </Container>
    )
}
