import { describe, expect, it } from "vitest"
import {
    CreateInvoiceSchema,
    CreateTestInvoiceSchema,
    DeleteTestInvoicesSchema,
    OrderDocumentPostSchema,
    SyncLogsQuerySchema,
    TipoDocumentoSchema,
} from "./validators"

describe("TipoDocumentoSchema", () => {
    it("accepts PRE and FAC", () => {
        expect(TipoDocumentoSchema.safeParse("PRE").success).toBe(true)
        expect(TipoDocumentoSchema.safeParse("FAC").success).toBe(true)
    })

    it("rejects invalid values", () => {
        expect(TipoDocumentoSchema.safeParse("INVALID").success).toBe(false)
        expect(TipoDocumentoSchema.safeParse("").success).toBe(false)
        expect(TipoDocumentoSchema.safeParse(123).success).toBe(false)
    })
})

describe("CreateInvoiceSchema", () => {
    it("valid input with all fields", () => {
        const result = CreateInvoiceSchema.safeParse({
            action: "create",
            order_id: "order_123",
            tipo_documento: "PRE",
        })
        expect(result.success).toBe(true)
        expect(result.data).toEqual({
            action: "create",
            order_id: "order_123",
            tipo_documento: "PRE",
        })
    })

    it("defaults action=create and tipo_documento=FAC", () => {
        const result = CreateInvoiceSchema.safeParse({ order_id: "order_123" })
        expect(result.success).toBe(true)
        expect(result.data!.action).toBe("create")
        expect(result.data!.tipo_documento).toBe("FAC")
    })

    it("rejects missing order_id", () => {
        expect(CreateInvoiceSchema.safeParse({}).success).toBe(false)
    })

    it("rejects empty order_id", () => {
        expect(CreateInvoiceSchema.safeParse({ order_id: "" }).success).toBe(false)
    })

    it("rejects invalid tipo_documento", () => {
        expect(CreateInvoiceSchema.safeParse({ order_id: "x", tipo_documento: "BAD" }).success).toBe(false)
    })
})

describe("CreateTestInvoiceSchema", () => {
    it("valid with tipo_documento", () => {
        const result = CreateTestInvoiceSchema.safeParse({ tipo_documento: "FAC" })
        expect(result.success).toBe(true)
        expect(result.data!.tipo_documento).toBe("FAC")
    })

    it("defaults to PRE", () => {
        const result = CreateTestInvoiceSchema.safeParse({})
        expect(result.success).toBe(true)
        expect(result.data!.tipo_documento).toBe("PRE")
    })
})

describe("DeleteTestInvoicesSchema", () => {
    it("accepts empty object", () => {
        expect(DeleteTestInvoicesSchema.safeParse({}).success).toBe(true)
    })

    it("accepts action=delete-tests", () => {
        expect(DeleteTestInvoicesSchema.safeParse({ action: "delete-tests" }).success).toBe(true)
    })
})

describe("OrderDocumentPostSchema", () => {
    it("defaults action to create", () => {
        const result = OrderDocumentPostSchema.safeParse({})
        expect(result.success).toBe(true)
        expect(result.data!.action).toBe("create")
    })

    it("accepts update action", () => {
        const result = OrderDocumentPostSchema.safeParse({ action: "update", tipo_documento: "PRE" })
        expect(result.success).toBe(true)
        expect(result.data).toEqual({ action: "update", tipo_documento: "PRE" })
    })

    it("rejects invalid action", () => {
        expect(OrderDocumentPostSchema.safeParse({ action: "delete" }).success).toBe(false)
    })
})

describe("SyncLogsQuerySchema", () => {
    it("defaults limit=20 offset=0", () => {
        const result = SyncLogsQuerySchema.safeParse({})
        expect(result.success).toBe(true)
        expect(result.data).toMatchObject({ limit: 20, offset: 0 })
    })

    it("coerces string numbers", () => {
        const result = SyncLogsQuerySchema.safeParse({ limit: "50", offset: "10" })
        expect(result.success).toBe(true)
        expect(result.data!.limit).toBe(50)
        expect(result.data!.offset).toBe(10)
    })

    it("rejects limit > 100", () => {
        expect(SyncLogsQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
    })

    it("rejects limit < 1", () => {
        expect(SyncLogsQuerySchema.safeParse({ limit: 0 }).success).toBe(false)
    })

    it("rejects negative offset", () => {
        expect(SyncLogsQuerySchema.safeParse({ offset: -1 }).success).toBe(false)
    })

    it("accepts optional filters", () => {
        const result = SyncLogsQuerySchema.safeParse({
            sync_type: "products",
            status: ["completed", "failed"],
            parent_log_id: "log_abc",
        })
        expect(result.success).toBe(true)
        expect(result.data!.sync_type).toBe("products")
        expect(result.data!.status).toEqual(["completed", "failed"])
    })

    it("accepts string status", () => {
        const result = SyncLogsQuerySchema.safeParse({ status: "completed" })
        expect(result.success).toBe(true)
        expect(result.data!.status).toBe("completed")
    })
})
