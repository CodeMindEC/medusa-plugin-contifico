import { beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeAdvancedSettings } from "../advanced-settings"

const { mockGetAllProductos } = vi.hoisted(() => ({
    mockGetAllProductos: vi.fn(),
}))

vi.mock("../client", () => ({
    ContificoClient: vi.fn().mockImplementation(() => ({
        getAllProductos: mockGetAllProductos,
    })),
}))

import {
    buildDocumentoFromOrder,
    calculateOrderTotalsFromOrder,
} from "./invoice-payload"

function createInvoiceConfig(syncProductsEnabled: boolean) {
    return {
        api_key: "key_1",
        api_pos: "pos_1",
        auto_invoice_enabled: true,
        auto_preinvoice_enabled: false,
        sync_products_enabled: syncProductsEnabled,
        invoice_test_mode: false,
        variant_mode: "weighted" as const,
        weighted_pvp_field: "pvp1" as const,
        advanced_settings: normalizeAdvancedSettings({
            weighted: {
                allow_weighted_price_sync: true,
                pricing_strategy: "rules_by_weight",
                strategy_config: {
                    fallback_field: "pvp1",
                    rules: [{ grams: 100, field: "pvp1" }],
                },
            },
        }),
    }
}

function createService(allowWeightedPriceSync: boolean) {
    return {
        listContificoEntityMaps: vi.fn().mockImplementation((filters) => {
            if (filters.entity_type === "product") {
                return Promise.resolve([
                    {
                        contifico_id: "cp_1",
                        metadata: {
                            mapping_mode_override: "weighted",
                            product_rules_override: {
                                weighted: {
                                    allow_weighted_price_sync: allowWeightedPriceSync,
                                },
                            },
                        },
                    },
                ])
            }

            return Promise.resolve([])
        }),
    }
}

describe("invoice payload use case", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockGetAllProductos.mockResolvedValue([
            {
                id: "cp_1",
                nombre: "MANDARINA DESHIDRATADA GR",
                pvp1: "0.055500",
                pvp2: "0.055800",
                pvp3: "0.055900",
                pvp4: null,
            },
        ])
    })

    it("preserves the Medusa line total in weighted mode when official price sync is disabled", async () => {
        const documento = await buildDocumentoFromOrder(
            {
                id: "order_1",
                display_id: 101,
                email: "cliente@test.com",
                items: [
                    {
                        id: "item_1",
                        product_id: "prod_1",
                        title: "Mandarina 100g",
                        unit_price: 6,
                        quantity: 1,
                        variant: {
                            title: "100g",
                            sku: "MAN-100",
                            weight: 100,
                            metadata: {},
                        },
                    },
                ],
            },
            "FAC",
            createService(false) as never,
            createInvoiceConfig(true)
        )

        expect(documento.detalles).toEqual([
            expect.objectContaining({
                producto_id: "cp_1",
                cantidad: 100,
                precio: 0.06,
                base_gravable: 6,
                serie: "PVP1",
            }),
        ])
        expect(documento.subtotal_12).toBe(6)
        expect(documento.iva).toBe(0.9)
        expect(documento.total).toBe(6.9)
    })

    it("uses the official Contifico weighted price when weighted price sync is enabled", async () => {
        const documento = await buildDocumentoFromOrder(
            {
                id: "order_2",
                display_id: 102,
                email: "cliente@test.com",
                items: [
                    {
                        id: "item_1",
                        product_id: "prod_1",
                        title: "Mandarina 100g",
                        unit_price: 6,
                        quantity: 1,
                        variant: {
                            title: "100g",
                            sku: "MAN-100",
                            weight: 100,
                            metadata: {},
                        },
                    },
                ],
            },
            "FAC",
            createService(true) as never,
            createInvoiceConfig(true)
        )

        expect(documento.detalles).toEqual([
            expect.objectContaining({
                producto_id: "cp_1",
                cantidad: 100,
                precio: 0.0555,
                base_gravable: 5.55,
                serie: "PVP1",
            }),
        ])
        expect(documento.subtotal_12).toBe(5.55)
        expect(documento.iva).toBe(0.83)
        expect(documento.total).toBe(6.38)
    })

    it("uses the weighted average price when grouping multiple official PVP fields into one line", async () => {
        const documento = await buildDocumentoFromOrder(
            {
                id: "order_3",
                display_id: 103,
                email: "cliente@test.com",
                items: [
                    {
                        id: "item_1",
                        product_id: "prod_1",
                        title: "Mandarina 100g",
                        unit_price: 6,
                        quantity: 1,
                        variant: {
                            title: "100g",
                            sku: "MAN-100",
                            weight: 100,
                            metadata: {},
                        },
                    },
                    {
                        id: "item_2",
                        product_id: "prod_1",
                        title: "Mandarina 250g",
                        unit_price: 14,
                        quantity: 1,
                        variant: {
                            title: "250g",
                            sku: "MAN-250",
                            weight: 250,
                            metadata: {},
                        },
                    },
                ],
            },
            "FAC",
            createService(true) as never,
            {
                ...createInvoiceConfig(true),
                advanced_settings: normalizeAdvancedSettings({
                    weighted: {
                        allow_weighted_price_sync: true,
                        pricing_strategy: "rules_by_weight",
                        strategy_config: {
                            fallback_field: "pvp1",
                            rules: [
                                { grams: 100, field: "pvp1" },
                                { grams: 250, field: "pvp2" },
                            ],
                        },
                    },
                }),
            }
        )

        expect(documento.detalles).toEqual([
            expect.objectContaining({
                producto_id: "cp_1",
                cantidad: 350,
                precio: 0.055714,
                base_gravable: 19.5,
                serie: "PVP-MIX",
            }),
        ])
        expect(documento.subtotal_12).toBe(19.5)
        expect(documento.total).toBe(22.42)
    })

    it("calculates the Medusa order subtotal from order items", () => {
        expect(
            calculateOrderTotalsFromOrder({
                items: [
                    {
                        id: "item_1",
                        unit_price: 5.55,
                        quantity: 1,
                    },
                    {
                        id: "item_2",
                        detail: {
                            unit_price: 13.95,
                            quantity: 2,
                        },
                    },
                ],
            })
        ).toEqual({
            subtotal: 33.45,
            items: 2,
        })
    })

    it("uses cedula and billing data from a guest order when customer metadata is missing", async () => {
        const documento = await buildDocumentoFromOrder(
            {
                id: "order_guest",
                display_id: 104,
                email: "guest@test.com",
                metadata: {
                    cedula: "0102030405",
                },
                billing_address: {
                    first_name: "Ana",
                    last_name: "Perez",
                    address_1: "Av. Siempre Viva 123",
                    city: "Quito",
                    phone: "0999999999",
                    metadata: {
                        cedula: "0102030405",
                    },
                },
                shipping_address: {
                    first_name: "Ana",
                    last_name: "Perez",
                    address_1: "Av. Siempre Viva 123",
                    city: "Quito",
                    phone: "0999999999",
                    metadata: {
                        cedula: "0102030405",
                    },
                },
                items: [
                    {
                        id: "item_1",
                        product_id: "prod_1",
                        title: "Mandarina 100g",
                        unit_price: 6,
                        quantity: 1,
                        variant: {
                            title: "100g",
                            sku: "MAN-100",
                            weight: 100,
                            metadata: {},
                        },
                    },
                ],
            },
            "FAC",
            createService(false) as never,
            createInvoiceConfig(true)
        )

        expect(documento.cliente).toEqual(
            expect.objectContaining({
                cedula: "0102030405",
                razon_social: "Ana Perez",
                email: "guest@test.com",
                direccion: "Av. Siempre Viva 123",
                telefonos: "0999999999",
            })
        )
    })

    it("respects tipo_persona metadata for guest orders with business documents", async () => {
        const documento = await buildDocumentoFromOrder(
            {
                id: "order_business_guest",
                display_id: 105,
                email: "empresa@test.com",
                metadata: {
                    ruc: "1790016919001",
                    tipo_persona: "J",
                },
                billing_address: {
                    first_name: "Empresa",
                    last_name: "Demo",
                    address_1: "Av. Naciones Unidas",
                    city: "Quito",
                    phone: "022222222",
                    metadata: {
                        ruc: "1790016919001",
                        tipo_persona: "J",
                    },
                },
                items: [
                    {
                        id: "item_1",
                        product_id: "prod_1",
                        title: "Mandarina 100g",
                        unit_price: 6,
                        quantity: 1,
                        variant: {
                            title: "100g",
                            sku: "MAN-100",
                            weight: 100,
                            metadata: {},
                        },
                    },
                ],
            },
            "FAC",
            createService(false) as never,
            createInvoiceConfig(true)
        )

        expect(documento.cliente).toEqual(
            expect.objectContaining({
                cedula: "1790016919001",
                tipo: "J",
            })
        )
    })

    it("applies promotion adjustments as porcentaje_descuento on simple (non-weighted) items", async () => {
        const simpleService = {
            listContificoEntityMaps: vi.fn().mockImplementation((filters: any) => {
                if (filters.entity_type === "product") {
                    return Promise.resolve([
                        { contifico_id: "cp_1", metadata: {} },
                    ])
                }
                return Promise.resolve([])
            }),
        }

        const documento = await buildDocumentoFromOrder(
            {
                id: "order_promo_simple",
                display_id: 200,
                email: "promo@test.com",
                items: [
                    {
                        id: "item_1",
                        product_id: "prod_1",
                        title: "Mandarina 100g",
                        unit_price: 10,
                        quantity: 2,
                        variant: {
                            title: "100g",
                            sku: "MAN-100",
                            weight: 100,
                            metadata: {},
                        },
                        adjustments: [
                            { id: "adj_1", amount: 4, code: "VERANO20", description: "20% verano" },
                        ],
                    },
                ],
            },
            "FAC",
            simpleService as never,
            {
                ...createInvoiceConfig(false),
                variant_mode: "simple" as const,
            }
        )

        expect(documento.detalles).toEqual([
            expect.objectContaining({
                producto_id: "cp_1",
                cantidad: 2,
                precio: 10,
                base_gravable: 16,
                porcentaje_descuento: 20,
            }),
        ])
        expect(documento.subtotal_12).toBe(16)
        expect(documento.iva).toBe(2.4)
        expect(documento.total).toBe(18.4)
    })

    it("applies promotion adjustments in weighted mode (Medusa price fallback)", async () => {
        const documento = await buildDocumentoFromOrder(
            {
                id: "order_promo_weighted",
                display_id: 201,
                email: "promo@test.com",
                items: [
                    {
                        id: "item_1",
                        product_id: "prod_1",
                        title: "Mandarina 100g",
                        unit_price: 6,
                        quantity: 1,
                        variant: {
                            title: "100g",
                            sku: "MAN-100",
                            weight: 100,
                            metadata: {},
                        },
                        adjustments: [
                            { id: "adj_1", amount: 1.5, code: "DESC25", description: "25% descuento" },
                        ],
                    },
                ],
            },
            "FAC",
            createService(false) as never,
            createInvoiceConfig(true)
        )

        // grossLineTotal = 6, itemDiscountTotal = 1.5
        // weightedBaseGravable = gross - discount = 6 - 1.5 = 4.5
        // grossBase for porcentaje = 4.5 + 1.5 = 6
        // porcentaje_descuento = (1.5 / 6) * 100 = 25
        expect(documento.detalles).toEqual([
            expect.objectContaining({
                producto_id: "cp_1",
                cantidad: 100,
                base_gravable: 4.5,
                porcentaje_descuento: 25,
            }),
        ])
        expect(documento.subtotal_12).toBe(4.5)
    })

    it("applies promotion adjustments in weighted mode with Contifico official price", async () => {
        const documento = await buildDocumentoFromOrder(
            {
                id: "order_promo_weighted_official",
                display_id: 202,
                email: "promo@test.com",
                items: [
                    {
                        id: "item_1",
                        product_id: "prod_1",
                        title: "Mandarina 100g",
                        unit_price: 6,
                        quantity: 1,
                        variant: {
                            title: "100g",
                            sku: "MAN-100",
                            weight: 100,
                            metadata: {},
                        },
                        adjustments: [
                            { id: "adj_1", amount: 1.2, code: "PROMO10", description: "Promo" },
                        ],
                    },
                ],
            },
            "FAC",
            createService(true) as never,
            createInvoiceConfig(true)
        )

        // Contifico official: 100g * 0.0555 = 5.55, minus 1.2 = 4.35
        expect(documento.detalles).toEqual([
            expect.objectContaining({
                producto_id: "cp_1",
                cantidad: 100,
                base_gravable: 4.35,
            }),
        ])
        expect(documento.subtotal_12).toBe(4.35)
    })

    it("handles orders with no adjustments (promotions) without changes", async () => {
        const documento = await buildDocumentoFromOrder(
            {
                id: "order_no_promo",
                display_id: 203,
                email: "normal@test.com",
                items: [
                    {
                        id: "item_1",
                        product_id: "prod_1",
                        title: "Mandarina 100g",
                        unit_price: 6,
                        quantity: 1,
                        variant: {
                            title: "100g",
                            sku: "MAN-100",
                            weight: 100,
                            metadata: {},
                        },
                    },
                ],
            },
            "FAC",
            createService(false) as never,
            createInvoiceConfig(true)
        )

        expect(documento.detalles[0]).toEqual(
            expect.objectContaining({
                porcentaje_descuento: 0,
                base_gravable: 6,
            })
        )
    })

    it("includes discount from adjustments in calculateOrderTotalsFromOrder", () => {
        expect(
            calculateOrderTotalsFromOrder({
                items: [
                    {
                        id: "item_1",
                        unit_price: 10,
                        quantity: 2,
                        adjustments: [
                            { id: "adj_1", amount: 5 },
                        ],
                    },
                    {
                        id: "item_2",
                        unit_price: 8,
                        quantity: 1,
                    },
                ],
            })
        ).toEqual({
            subtotal: 23,
            items: 2,
        })
    })
})
