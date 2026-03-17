import { z } from "@medusajs/framework/zod"

export const TipoDocumentoSchema = z.enum(["PRE", "FAC"])

export const CreateInvoiceSchema = z.object({
    action: z.literal("create").optional().default("create"),
    order_id: z.string().min(1, "order_id es requerido"),
    tipo_documento: TipoDocumentoSchema.optional().default("FAC"),
})

export const CreateTestInvoiceSchema = z.object({
    action: z.literal("create-test").optional(),
    tipo_documento: TipoDocumentoSchema.optional().default("PRE"),
})

export const DeleteTestInvoicesSchema = z.object({
    action: z.literal("delete-tests").optional(),
})

export const OrderDocumentPostSchema = z.object({
    tipo_documento: TipoDocumentoSchema.optional(),
    action: z.enum(["create", "update"]).optional().default("create"),
})

export const SyncLogsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
    sync_type: z.string().optional(),
    status: z.union([z.string(), z.array(z.string())]).optional(),
    parent_log_id: z.string().optional(),
})

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>
export type CreateTestInvoiceInput = z.infer<typeof CreateTestInvoiceSchema>
export type OrderDocumentPostInput = z.infer<typeof OrderDocumentPostSchema>
export type SyncLogsQuery = z.infer<typeof SyncLogsQuerySchema>
