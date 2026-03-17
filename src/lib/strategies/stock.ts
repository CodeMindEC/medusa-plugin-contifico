import type { StockAdvancedSettings, StrategyDecision } from "../advanced-settings"

export interface StockPolicyResult {
    should_sync_levels: boolean
    use_primary_only: boolean
    decisions: Array<StrategyDecision<unknown>>
}

export function resolveStockPolicy(settings: StockAdvancedSettings): StockPolicyResult {
    const decisions: Array<StrategyDecision<unknown>> = [{
        strategy: "stock:mode",
        value: settings.mode,
        reason: "Modo de stock efectivo",
    }]

    if (settings.mode === "report_only" || settings.mode === "manual") {
        return {
            should_sync_levels: false,
            use_primary_only: false,
            decisions,
        }
    }

    return {
        should_sync_levels: true,
        use_primary_only: settings.mode === "primary_only",
        decisions,
    }
}
