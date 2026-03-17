import { describe, expect, it } from "vitest"
import {
    getContificoConfigMigrationPatch,
    normalizeContificoConfig,
    type ContificoConfigRecord,
} from "./contifico-config"

const baseRecord: ContificoConfigRecord = {
    id: "ccfg_123",
    api_key: "key",
    api_pos: "pos",
    bodega_ids: "b1,b2",
    sync_products_enabled: true,
    sync_customers_enabled: false,
    auto_invoice_enabled: false,
    auto_preinvoice_enabled: false,
    sync_interval_minutes: 60,
    manage_inventory: true,
    allow_backorder: false,
    sales_channel_id: null,
    shipping_profile_id: null,
    variant_mode: "weighted",
    weighted_pvp_field: "pvp3",
    advanced_settings: JSON.stringify({
        version: 1,
        weighted: {
            enabled: true,
            pvp_field_by_grams: [
                { grams: 100, field: "pvp1" },
                { grams: 250, field: "pvp2" },
            ],
        },
    }),
    invoice_test_mode: false,
    last_product_sync: null,
    last_customer_sync: null,
    import_filters: null,
}

describe("contifico config normalization", () => {
    it("normalizes legacy config into a v2 runtime shape", () => {
        const normalized = normalizeContificoConfig(baseRecord)

        expect(normalized?.advanced_settings.version).toBe(2)
        expect(normalized?.advanced_settings.weighted.pricing_strategy).toBe(
            "rules_by_weight"
        )
        expect(normalized?.weighted_pvp_field).toBe("pvp3")
        expect(normalized?.variant_mode).toBe("weighted")
    })

    it("returns a persistence patch when advanced settings must be migrated", () => {
        const patch = getContificoConfigMigrationPatch(baseRecord)

        expect(patch).toBeTruthy()
        expect(patch?.weighted_pvp_field).toBeUndefined()
        expect(patch?.advanced_settings).toContain('"version":2')
        expect(patch?.advanced_settings).toContain('"migration_status":"migrated_v2"')
    })
})
