import type {
    InvoicingAdvancedSettings,
    StrategyDecision,
} from "../advanced-settings"

export function renderTemplate(
    template: string,
    values: Record<string, string | number | null | undefined>
): { value: string; decision: StrategyDecision<string> } {
    const value = template.replace(/\{([^}]+)\}/g, (_, token: string) => {
        const raw = values[token]
        return raw == null ? "" : String(raw)
    })

    return {
        value,
        decision: {
            strategy: "invoicing:template",
            value,
            reason: `Template aplicado: ${template}`,
        },
    }
}

export function describeInvoicePolicy(
    settings: InvoicingAdvancedSettings
): Array<StrategyDecision<unknown>> {
    return [{
        strategy: "invoicing:on_missing_mapping",
        value: settings.on_missing_mapping,
        reason: "Política de faltantes",
    }]
}
