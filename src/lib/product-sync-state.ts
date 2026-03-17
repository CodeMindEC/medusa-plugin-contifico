export type ProductCleanupState = "pending" | "failed"

export interface ProductSyncState {
    catalog_fingerprint?: string | null
    weighted_config_fingerprint?: string | null
    last_catalog_sync_at?: string | null
    last_stock_total?: number | null
    last_stock_hash?: string | null
    last_stock_sync_at?: string | null
    cleanup_state?: ProductCleanupState | null
    cleanup_requested_at?: string | null
    cleanup_last_error?: string | null
}

export function normalizeProductSyncState(
    value: unknown
): ProductSyncState | undefined {
    if (!isRecord(value)) {
        return undefined
    }

    const next: ProductSyncState = {
        catalog_fingerprint: asOptionalString(value.catalog_fingerprint),
        weighted_config_fingerprint: asOptionalString(
            value.weighted_config_fingerprint
        ),
        last_catalog_sync_at: asOptionalString(value.last_catalog_sync_at),
        last_stock_total: asOptionalFiniteNumber(value.last_stock_total),
        last_stock_hash: asOptionalString(value.last_stock_hash),
        last_stock_sync_at: asOptionalString(value.last_stock_sync_at),
        cleanup_state: normalizeCleanupState(value.cleanup_state),
        cleanup_requested_at: asOptionalString(value.cleanup_requested_at),
        cleanup_last_error: asOptionalString(value.cleanup_last_error),
    }

    return hasValues(next) ? next : undefined
}

function normalizeCleanupState(value: unknown): ProductCleanupState | null {
    switch (value) {
        case "pending":
        case "failed":
            return value
        default:
            return null
    }
}

function asOptionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null
}

function asOptionalFiniteNumber(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null
    }

    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number.parseFloat(value)
        return Number.isFinite(parsed) ? parsed : null
    }

    return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function hasValues(value: ProductSyncState): boolean {
    return Object.values(value).some((entry) => entry !== null && entry !== undefined)
}
