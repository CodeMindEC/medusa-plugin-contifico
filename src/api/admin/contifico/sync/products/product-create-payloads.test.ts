import { describe, expect, it } from "vitest"
import { buildCreatedProductMapMetadata } from "./product-create-payloads"

describe("product create payloads", () => {
    it("seeds sync fingerprints for newly created weighted products", () => {
        const metadata = buildCreatedProductMapMetadata({
            source: {
                codigo: "SKU-1",
                nombre: "Producto weighted",
                imagen: "https://cdn.example.com/producto.png",
                cantidad_stock: "123.45",
            },
            profile_id: "profile_1",
            catalogFingerprint: "catalog_fp_1",
            weightedConfigFingerprint: "weighted_fp_1",
            syncTimestamp: "2026-03-15T18:45:00.000Z",
        })

        expect(metadata).toMatchObject({
            codigo: "SKU-1",
            nombre: "Producto weighted",
            created: true,
            link_origin: "plugin_created",
            contifico_stock_grams: 123.45,
            weighted_creation_profile_id: "profile_1",
            sync_state: expect.objectContaining({
                catalog_fingerprint: "catalog_fp_1",
                weighted_config_fingerprint: "weighted_fp_1",
                last_catalog_sync_at: "2026-03-15T18:45:00.000Z",
                cleanup_state: null,
                cleanup_last_error: null,
            }),
        })
    })
})
