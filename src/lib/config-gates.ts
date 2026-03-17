import type { AdvancedContificoSettings } from "./advanced-settings"
import type { VariantMode } from "./contifico-config"
import { getWeightedPriceStrategyDefinition } from "./weighted-price-strategies"

export interface ConfigUiContext {
    api_key: string
    api_pos: string
    sync_products_enabled: boolean
    sync_customers_enabled: boolean
    auto_invoice_enabled: boolean
    auto_preinvoice_enabled: boolean
    variant_mode: VariantMode
    advanced_settings: AdvancedContificoSettings | null
}

type GatePredicate = (context: ConfigUiContext) => boolean

export interface ConfigGateDefinition {
    visibleWhen?: GatePredicate
    enabledWhen?: GatePredicate
    disabledReason?: string | ((context: ConfigUiContext) => string)
}

export interface ResolvedConfigGate {
    visible: boolean
    enabled: boolean
    disabledReason: string | null
}

export const CONTIFICO_CONFIG_GATES = {
    weighted_strategy: {
        visibleWhen: (context) => context.variant_mode === "weighted",
        enabledWhen: (context) => Boolean(context.advanced_settings),
        disabledReason: "Corrige el JSON de configuración avanzada para editar esta estrategia.",
    },
    weighted_creation_mode: {
        visibleWhen: (context) => context.variant_mode === "weighted",
        enabledWhen: (context) => Boolean(context.advanced_settings),
        disabledReason:
            "Corrige el JSON de configuración avanzada para editar la creación automática weighted.",
    },
    weighted_creation_profiles: {
        visibleWhen: (context) =>
            context.variant_mode === "weighted" &&
            context.advanced_settings?.weighted.creation_mode === "presentation_profile",
        enabledWhen: (context) => Boolean(context.advanced_settings),
        disabledReason:
            "Corrige el JSON de configuración avanzada para editar perfiles weighted.",
    },
    weighted_fixed_field: {
        visibleWhen: (context) =>
            context.variant_mode === "weighted" &&
            getWeightedCapabilities(context).uses_fixed_field,
        enabledWhen: (context) => Boolean(context.advanced_settings),
        disabledReason: "Corrige el JSON de configuración avanzada para editar este campo.",
    },
    weighted_rules: {
        visibleWhen: (context) =>
            context.variant_mode === "weighted" &&
            getWeightedCapabilities(context).uses_weight_rules,
        enabledWhen: (context) => Boolean(context.advanced_settings),
        disabledReason: "Corrige el JSON de configuración avanzada para editar las reglas.",
    },
    weighted_price_lock: {
        visibleWhen: (context) => context.variant_mode === "weighted",
        enabledWhen: (context) =>
            Boolean(context.advanced_settings) &&
            context.sync_products_enabled &&
            getWeightedCapabilities(context).supports_price_lock,
        disabledReason: (context) => {
            if (!context.advanced_settings) {
                return "Corrige el JSON de configuración avanzada para editar este control."
            }

            if (!context.sync_products_enabled) {
                return "Activa la sincronización de productos para que el bloqueo de precios tenga efecto."
            }

            return "La estrategia weighted activa no soporta bloqueo de precio."
        },
    },
    auto_invoice: {
        enabledWhen: (context) => Boolean(context.api_pos),
        disabledReason: "Configura API POS para habilitar la facturación y prefacturación automática.",
    },
    sync_interval: {
        enabledWhen: (context) =>
            context.sync_products_enabled ||
            context.sync_customers_enabled ||
            context.auto_invoice_enabled ||
            context.auto_preinvoice_enabled,
        disabledReason:
            "Activa al menos una tarea automática para usar el intervalo de sincronización.",
    },
    product_sync_actions: {
        enabledWhen: (context) => Boolean(context.api_key),
        disabledReason: "Configura la API Key de Contífico para sincronizar productos.",
    },
    delete_imported_products: {
        enabledWhen: (context) =>
            Boolean(context.api_key) && context.sync_products_enabled,
        disabledReason: (context) =>
            !context.api_key
                ? "Configura la API Key de Contífico para usar esta acción."
                : "Activa la sincronización de productos antes de borrar importados.",
    },
} satisfies Record<string, ConfigGateDefinition>

export function resolveConfigGate(
    definition: ConfigGateDefinition,
    context: ConfigUiContext
): ResolvedConfigGate {
    const visible = definition.visibleWhen ? definition.visibleWhen(context) : true
    const enabled = visible
        ? definition.enabledWhen
            ? definition.enabledWhen(context)
            : true
        : false

    return {
        visible,
        enabled,
        disabledReason: enabled
            ? null
            : typeof definition.disabledReason === "function"
              ? definition.disabledReason(context)
              : definition.disabledReason || null,
    }
}

function getWeightedCapabilities(context: ConfigUiContext) {
    const strategy =
        context.advanced_settings?.weighted.pricing_strategy || "fixed_pvp_field"
    return getWeightedPriceStrategyDefinition(strategy).capabilities
}
