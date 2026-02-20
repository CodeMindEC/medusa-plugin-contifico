import { z } from "zod"

export const UpdateContificoConfigSchema = z.object({
    api_key: z.string().min(1, "API Key es requerida"),
    api_pos: z.string().nullable().optional(),
    bodega_ids: z.array(z.string()).optional(),
    sync_products_enabled: z.boolean().optional(),
    sync_customers_enabled: z.boolean().optional(),
    auto_invoice_enabled: z.boolean().optional(),
    sync_interval_minutes: z.number().min(5).max(1440).optional(),
    manage_inventory: z.boolean().optional(),
    allow_backorder: z.boolean().optional(),
    sales_channel_id: z.string().nullable().optional(),
    shipping_profile_id: z.string().nullable().optional(),
    variant_mode: z.enum(["auto", "contifico", "simple"]).optional(),
    invoice_test_mode: z.boolean().optional(),
})

export type UpdateContificoConfigInput = z.infer<typeof UpdateContificoConfigSchema>
