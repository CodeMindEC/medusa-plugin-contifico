import type {
    DeletePolicyAdvancedSettings,
    PreviewResult,
    StrategyDecision,
} from "../advanced-settings"
import type { ProductLinkOrigin, ProductSyncSnapshot } from "../contifico-metadata"

export function canDeleteLinkedProduct(
    linkOrigin: ProductLinkOrigin,
    settings: DeletePolicyAdvancedSettings
): { allow: boolean; decision: StrategyDecision<boolean> } {
    const allow = settings.product_delete_scope === "plugin_created_only"
        ? linkOrigin === "plugin_created"
        : false

    return {
        allow,
        decision: {
            strategy: "delete_policy:product_delete_scope",
            value: allow,
            reason: `Origen ${linkOrigin}, scope ${settings.product_delete_scope}`,
        },
    }
}

export function resolveLinkedProductCleanup(
    linkOrigin: ProductLinkOrigin,
    settings: DeletePolicyAdvancedSettings,
    syncSnapshot?: ProductSyncSnapshot | null
): {
    action: "delete_product" | "unlink_only"
    restore_prices: boolean
    decision: StrategyDecision<string>
} {
    const deleteDecision = canDeleteLinkedProduct(linkOrigin, settings)
    if (deleteDecision.allow) {
        return {
            action: "delete_product",
            restore_prices: false,
            decision: {
                strategy: "delete_policy:cleanup_action",
                value: "delete_product",
                reason: `Origen ${linkOrigin}: se eliminará el producto Medusa y su vínculo`,
            },
        }
    }

    const restorePrices = !!syncSnapshot?.variant_price_sets?.some(
        (entry) => !!entry.price_set_id && entry.prices.length > 0
    )

    return {
        action: "unlink_only",
        restore_prices: restorePrices,
        decision: {
            strategy: "delete_policy:cleanup_action",
            value: restorePrices ? "unlink_restore_prices" : "unlink_only",
            reason: `Origen ${linkOrigin}: se quitará la sincronización${restorePrices ? " y se restaurarán precios" : " sin snapshot de precio"}`,
        },
    }
}

export function buildDeletePreviewResult(
    summary: Record<string, unknown>,
    decisions: Array<StrategyDecision<unknown>>,
    blockers: string[] = [],
    warnings: string[] = []
): PreviewResult {
    return {
        ok: blockers.length === 0,
        summary,
        decisions,
        warnings,
        blockers,
    }
}
