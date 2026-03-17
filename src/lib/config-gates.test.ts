import { describe, expect, it } from "vitest"
import { normalizeAdvancedSettings } from "./advanced-settings"
import { CONTIFICO_CONFIG_GATES, resolveConfigGate } from "./config-gates"

describe("config gates", () => {
    it("only shows weighted rules when the weighted strategy uses them", () => {
        const rulesContext = {
            api_key: "key",
            api_pos: "pos",
            sync_products_enabled: true,
            sync_customers_enabled: false,
            auto_invoice_enabled: false,
            auto_preinvoice_enabled: false,
            variant_mode: "weighted" as const,
            advanced_settings: normalizeAdvancedSettings({
                version: 2,
                weighted: {
                    enabled: true,
                    pricing_strategy: "rules_by_weight",
                    strategy_config: {
                        fallback_field: "pvp1",
                        rules: [{ grams: 100, field: "pvp1" }],
                    },
                },
            }),
        }
        const fixedContext = {
            ...rulesContext,
            advanced_settings: normalizeAdvancedSettings({
                version: 2,
                weighted: {
                    enabled: true,
                    pricing_strategy: "fixed_pvp_field",
                    strategy_config: {
                        field: "pvp2",
                    },
                },
            }),
        }

        expect(
            resolveConfigGate(CONTIFICO_CONFIG_GATES.weighted_rules, rulesContext)
                .visible
        ).toBe(true)
        expect(
            resolveConfigGate(CONTIFICO_CONFIG_GATES.weighted_rules, fixedContext)
                .visible
        ).toBe(false)
    })

    it("disables price lock when product sync is off", () => {
        const gate = resolveConfigGate(CONTIFICO_CONFIG_GATES.weighted_price_lock, {
            api_key: "key",
            api_pos: "pos",
            sync_products_enabled: false,
            sync_customers_enabled: false,
            auto_invoice_enabled: false,
            auto_preinvoice_enabled: false,
            variant_mode: "weighted",
            advanced_settings: normalizeAdvancedSettings({
                version: 2,
                weighted: {
                    enabled: true,
                    pricing_strategy: "fixed_pvp_field",
                    strategy_config: {
                        field: "pvp1",
                    },
                },
            }),
        })

        expect(gate.visible).toBe(true)
        expect(gate.enabled).toBe(false)
        expect(gate.disabledReason).toContain("sincronización de productos")
    })

    it("only shows weighted creation profiles when the creation mode uses them", () => {
        const profilesContext = {
            api_key: "key",
            api_pos: "pos",
            sync_products_enabled: true,
            sync_customers_enabled: false,
            auto_invoice_enabled: false,
            auto_preinvoice_enabled: false,
            variant_mode: "weighted" as const,
            advanced_settings: normalizeAdvancedSettings({
                version: 2,
                weighted: {
                    enabled: true,
                    creation_mode: "presentation_profile",
                    creation_profiles: [
                        {
                            id: "retail",
                            name: "Retail",
                            variants: [{ grams: 100, pvp_field: "pvp1" }],
                        },
                    ],
                },
            }),
        }
        const manualContext = {
            ...profilesContext,
            advanced_settings: normalizeAdvancedSettings({
                version: 2,
                weighted: {
                    enabled: true,
                    creation_mode: "manual_only",
                },
            }),
        }

        expect(
            resolveConfigGate(
                CONTIFICO_CONFIG_GATES.weighted_creation_profiles,
                profilesContext
            ).visible
        ).toBe(true)
        expect(
            resolveConfigGate(
                CONTIFICO_CONFIG_GATES.weighted_creation_profiles,
                manualContext
            ).visible
        ).toBe(false)
    })

    it("requires API POS for automatic invoicing", () => {
        const gate = resolveConfigGate(CONTIFICO_CONFIG_GATES.auto_invoice, {
            api_key: "key",
            api_pos: "",
            sync_products_enabled: false,
            sync_customers_enabled: false,
            auto_invoice_enabled: false,
            auto_preinvoice_enabled: false,
            variant_mode: "auto",
            advanced_settings: normalizeAdvancedSettings({
                version: 2,
            }),
        })

        expect(gate.enabled).toBe(false)
        expect(gate.disabledReason).toContain("API POS")
    })
})
