import { describe, expect, it, vi } from "vitest"
import {
    buildInvoiceEntityMapKey,
    createOrderInvoiceDocument,
    getOrderInvoiceDocumentsStatus,
} from "./invoice-documents"
import type { InvoiceConfig, InvoiceOrderGraph } from "../../api/admin/contifico/invoices/shared"

function buildConfig(overrides: Partial<InvoiceConfig> = {}): InvoiceConfig {
    return {
        api_key: "key",
        api_pos: "pos",
        auto_invoice_enabled: true,
        auto_preinvoice_enabled: false,
        sync_products_enabled: true,
        invoice_test_mode: false,
        variant_mode: "auto",
        weighted_pvp_field: "pvp1",
        advanced_settings: {
            version: 2,
            migration_status: "native_v2",
            matching: {
                priority: ["sku", "barcode", "exact_name", "similar_name"],
                similarity_threshold: 0.8,
                allow_auto_link: true,
                exclude_if_multiple_candidates: true,
            },
            pricing: {
                default_pvp_field: "pvp1",
                rounding_mode: "2_decimals",
                markup_percent: null,
                minimum_price: null,
            },
            weighted: {
                enabled: false,
                creation_mode: "manual_only",
                default_profile_id: "default",
                creation_profiles: [],
                weight_source: "variant_weight_with_metadata_override",
                invoice_grouping: "group_by_contifico_product",
                block_if_missing_weight: true,
                allow_weighted_price_sync: true,
                pricing_strategy: "fixed_pvp_field",
                strategy_config: {
                    field: "pvp1",
                },
            },
            stock: {
                mode: "normal",
                mismatch_policy: "use_total_stock",
            },
            invoicing: {
                on_missing_mapping: "error",
                on_missing_weighted_data: "error",
                reference_template: "MEDUSA-ORD-{display_id}",
                description_template: "Pedido Medusa #{display_id}",
            },
            delete_policy: {
                product_delete_scope: "plugin_created_only",
                require_preview: true,
            },
            sync_behavior: {
                dry_run_enabled: true,
                log_decisions: true,
            },
        },
        ...overrides,
    }
}

function buildOrder(
    orderId: string,
    overrides: Partial<InvoiceOrderGraph> = {}
): InvoiceOrderGraph {
    return {
        id: orderId,
        display_id: 101,
        email: "test@example.com",
        items: [],
        payment_status: null,
        ...overrides,
    }
}

describe("invoice document use cases", () => {
    it("skips creation when an active invoice of the same type already exists", async () => {
        const service = {
            listContificoEntityMaps: vi.fn().mockResolvedValue([
                {
                    id: "map_1",
                    medusa_id: "order_1:FAC",
                    contifico_id: "doc_1",
                    metadata: {
                        order_id: "order_1",
                        tipo_documento: "FAC",
                        estado: "C",
                        referencia: "REF-1",
                    },
                },
            ]),
        }
        const query = {
            graph: vi.fn(),
        }
        const clientFactory = vi.fn()

        const result = await createOrderInvoiceDocument({
            service: service as never,
            query,
            config: buildConfig(),
            order_id: "order_1",
            tipo_documento: "FAC",
            trigger: "manual",
            clientFactory: clientFactory as never,
        })

        expect(result.status).toBe("duplicate")
        expect(result.existing).toEqual({
            contifico_id: "doc_1",
            referencia: "REF-1",
        })
        expect(query.graph).not.toHaveBeenCalled()
        expect(clientFactory).not.toHaveBeenCalled()
    })

    it("cancels the remote document if local typed key deduplication wins the race", async () => {
        const anularDocumento = vi.fn().mockResolvedValue(undefined)
        const service = {
            listContificoEntityMaps: vi
                .fn()
                .mockResolvedValueOnce([])
                .mockResolvedValue([
                    {
                        id: "map_existing",
                        medusa_id: "order_2:FAC",
                        contifico_id: "doc_existing",
                        metadata: {
                            order_id: "order_2",
                            tipo_documento: "FAC",
                            estado: "C",
                            referencia: "REF-EXISTING",
                        },
                    },
                ]),
            createContificoEntityMaps: vi
                .fn()
                .mockRejectedValue(new Error("duplicate key value violates unique constraint")),
            updateContificoEntityMaps: vi.fn().mockResolvedValue(undefined),
            createContificoSyncLogs: vi.fn().mockResolvedValue(undefined),
        }
        const query = {
            graph: vi.fn().mockResolvedValue({
                data: [buildOrder("order_2")],
            }),
        }
        const clientFactory = vi.fn().mockResolvedValue({
            getDocumentos: vi.fn().mockResolvedValue({
                results: [],
                next: null,
            }),
            createDocumento: vi.fn().mockResolvedValue({
                id: "doc_duplicate",
                estado: "P",
                total: "10.00",
                url_ride: null,
            }),
            anularDocumento,
        })
        const buildDocumento = vi.fn().mockResolvedValue({
            referencia: "REF-NEW",
            detalles: [],
            subtotal_12: 10,
            iva: 1.5,
            total: 11.5,
        })

        const result = await createOrderInvoiceDocument({
            service: service as never,
            query,
            config: buildConfig(),
            order_id: "order_2",
            tipo_documento: "FAC",
            trigger: "payment.captured",
            clientFactory: clientFactory as never,
            buildDocumento: buildDocumento as never,
        })

        expect(result.status).toBe("duplicate")
        expect(result.existing?.contifico_id).toBe("doc_existing")
        expect(anularDocumento).toHaveBeenCalledWith("doc_duplicate")
    })

    it("creates invoices with a typed medusa key for stronger idempotency", async () => {
        const createContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const service = {
            listContificoEntityMaps: vi.fn().mockResolvedValue([]),
            createContificoEntityMaps,
            createContificoSyncLogs: vi.fn().mockResolvedValue(undefined),
        }
        const query = {
            graph: vi.fn().mockResolvedValue({
                data: [buildOrder("order_3")],
            }),
        }
        const clientFactory = vi.fn().mockResolvedValue({
            getDocumentos: vi.fn().mockResolvedValue({
                results: [],
                next: null,
            }),
            createDocumento: vi.fn().mockResolvedValue({
                id: "doc_created",
                estado: "C",
                total: "12.30",
                url_ride: "ride",
            }),
            anularDocumento: vi.fn(),
        })
        const buildDocumento = vi.fn().mockResolvedValue({
            referencia: "REF-CREATED",
            detalles: [],
            subtotal_12: 10.7,
            iva: 1.6,
            total: 12.3,
        })

        const result = await createOrderInvoiceDocument({
            service: service as never,
            query,
            config: buildConfig(),
            order_id: "order_3",
            tipo_documento: "PRE",
            trigger: "manual",
            clientFactory: clientFactory as never,
            buildDocumento: buildDocumento as never,
        })

        expect(result.status).toBe("created")
        expect(createContificoEntityMaps).toHaveBeenCalledWith(
            expect.objectContaining({
                medusa_id: buildInvoiceEntityMapKey("order_3", "PRE", false),
            })
        )
    })

    it("links an existing remote document before attempting a new creation", async () => {
        const createContificoEntityMaps = vi.fn().mockResolvedValue(undefined)
        const createDocumento = vi.fn()
        const service = {
            listContificoEntityMaps: vi
                .fn()
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]),
            createContificoEntityMaps,
            createContificoSyncLogs: vi.fn().mockResolvedValue(undefined),
        }
        const query = {
            graph: vi.fn().mockResolvedValue({
                data: [buildOrder("order_4")],
            }),
        }
        const clientFactory = vi.fn().mockResolvedValue({
            getDocumentos: vi.fn().mockResolvedValue({
                results: [
                    {
                        id: "doc_remote_pre",
                        tipo_documento: "PRE",
                        referencia: "MEDUSA-ORD-101",
                        estado: "P",
                        total: "15.50",
                        documento: "001-001-000000111",
                        url_ride: "https://contifico.test/ride.pdf",
                        url_xml: "https://contifico.test/doc.xml",
                    },
                ],
                next: null,
            }),
            createDocumento,
            anularDocumento: vi.fn(),
        })
        const buildDocumento = vi.fn().mockResolvedValue({
            referencia: "MEDUSA-ORD-101",
            detalles: [],
            subtotal_12: 13.48,
            iva: 2.02,
            total: 15.5,
        })

        const result = await createOrderInvoiceDocument({
            service: service as never,
            query,
            config: buildConfig({
                advanced_settings: {
                    ...buildConfig().advanced_settings,
                    invoicing: {
                        ...buildConfig().advanced_settings.invoicing,
                        reference_template: "MEDUSA-ORD-{display_id}",
                    },
                },
            }),
            order_id: "order_4",
            tipo_documento: "PRE",
            trigger: "manual",
            clientFactory: clientFactory as never,
            buildDocumento: buildDocumento as never,
        })

        expect(result.status).toBe("linked")
        expect(result.documento?.id).toBe("doc_remote_pre")
        expect(createDocumento).not.toHaveBeenCalled()
        expect(createContificoEntityMaps).toHaveBeenCalledWith(
            expect.objectContaining({
                medusa_id: buildInvoiceEntityMapKey("order_4", "PRE", false),
                contifico_id: "doc_remote_pre",
            })
        )
    })

    it("enables prefactura when it is missing and keeps factura blocked until payment is captured", async () => {
        const service = {
            listContificoEntityMaps: vi.fn().mockResolvedValue([]),
        }
        const query = {
            graph: vi.fn().mockResolvedValue({
                data: [buildOrder("order_5", { payment_status: "awaiting" })],
            }),
        }

        const result = await getOrderInvoiceDocumentsStatus({
            service: service as never,
            query,
            config: buildConfig(),
            order_id: "order_5",
            clientFactory: vi.fn().mockResolvedValue(null) as never,
        })

        expect(result.actions.PRE.disabled).toBe(false)
        expect(result.actions.FAC.disabled).toBe(false)
        expect(result.actions.FAC.reason).toContain("pago")
    })
})
