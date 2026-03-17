import { beforeEach, describe, expect, it, vi } from "vitest"

const {
    mockCreateOrderInvoiceDocument,
    mockGetRequiredInvoiceConfig,
    mockLogContificoEvent,
} = vi.hoisted(() => ({
    mockCreateOrderInvoiceDocument: vi.fn(),
    mockGetRequiredInvoiceConfig: vi.fn(),
    mockLogContificoEvent: vi.fn(),
}))

vi.mock("../lib/use-cases/invoice-documents", () => ({
    createOrderInvoiceDocument: mockCreateOrderInvoiceDocument,
}))

vi.mock("../api/admin/contifico/invoices/shared", () => ({
    getRequiredInvoiceConfig: mockGetRequiredInvoiceConfig,
}))

vi.mock("../lib/observability", () => ({
    bindContificoLogger: vi.fn(),
    createCorrelationId: vi.fn((prefix: string) => `corr_${prefix}`),
    logContificoEvent: mockLogContificoEvent,
}))

import contificoOrderPlacedHandler from "./contifico-auto-invoice"
import contificoPaymentCapturedHandler from "./contifico-payment-captured"

describe("contifico subscribers", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("skips automatic prefactura creation when invoicing is not fully configured", async () => {
        mockGetRequiredInvoiceConfig.mockResolvedValue({
            api_key: "key_1",
            api_pos: "",
            auto_preinvoice_enabled: true,
        })

        await contificoOrderPlacedHandler({
            event: { data: { id: "order_1" } },
            container: {
                resolve: vi.fn().mockReturnValue({}),
            },
        } as never)

        expect(mockCreateOrderInvoiceDocument).not.toHaveBeenCalled()
    })

    it("creates a PRE document on order.placed when auto invoicing is enabled", async () => {
        const service = {}
        const query = {}
        mockGetRequiredInvoiceConfig.mockResolvedValue({
            api_key: "key_1",
            api_pos: "pos_1",
            auto_preinvoice_enabled: true,
        })
        mockCreateOrderInvoiceDocument.mockResolvedValue({
            status: "created",
            documento: { id: "doc_pre_1" },
        })

        await contificoOrderPlacedHandler({
            event: { data: { id: "order_2" } },
            container: {
                resolve: vi.fn((key: string) => (key === "query" ? query : service)),
            },
        } as never)

        expect(mockCreateOrderInvoiceDocument).toHaveBeenCalledWith({
            service,
            query,
            config: expect.objectContaining({
                api_key: "key_1",
                api_pos: "pos_1",
                auto_preinvoice_enabled: true,
            }),
            order_id: "order_2",
            tipo_documento: "PRE",
            trigger: "order.placed",
            correlation_id: "corr_contifico_order_placed",
        })
    })

    it("creates a FAC document on payment.captured when the payment resolves to an order", async () => {
        const service = {}
        const query = {
            graph: vi.fn().mockResolvedValue({
                data: [
                    {
                        id: "pay_1",
                        payment_collection: {
                            order: { id: "order_3" },
                        },
                    },
                ],
            }),
        }
        mockGetRequiredInvoiceConfig.mockResolvedValue({
            api_key: "key_1",
            api_pos: "pos_1",
            auto_invoice_enabled: true,
        })
        mockCreateOrderInvoiceDocument.mockResolvedValue({
            status: "created",
            documento: { id: "doc_fac_1" },
        })

        await contificoPaymentCapturedHandler({
            event: { data: { id: "pay_1" } },
            container: {
                resolve: vi.fn((key: string) => (key === "query" ? query : service)),
            },
        } as never)

        expect(query.graph).toHaveBeenCalledWith({
            entity: "payment",
            fields: ["id", "payment_collection.order.id"],
            filters: { id: "pay_1" },
        })
        expect(mockCreateOrderInvoiceDocument).toHaveBeenCalledWith({
            service,
            query,
            config: expect.objectContaining({
                api_key: "key_1",
                api_pos: "pos_1",
                auto_invoice_enabled: true,
            }),
            order_id: "order_3",
            tipo_documento: "FAC",
            trigger: "payment.captured",
            correlation_id: "corr_contifico_payment_captured",
        })
    })
})
