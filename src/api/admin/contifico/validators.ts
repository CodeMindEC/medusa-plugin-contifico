import { z } from "@medusajs/framework/zod"
import {
    FILTER_OPERATOR_VALUES,
    type ImportFilterConfig,
} from "../../../lib/contifico-filters"
import {
    VARIANT_MODE_VALUES,
    WEIGHTED_PVP_FIELD_VALUES,
} from "../../../lib/contifico-config"
import {
    DELETE_SCOPE_VALUES,
    INVOICE_MISSING_MAPPING_VALUES,
    MATCH_PRIORITY_VALUES,
    ROUNDING_MODE_VALUES,
    STOCK_MISMATCH_POLICY_VALUES,
    STOCK_MODE_VALUES,
} from "../../../lib/advanced-settings"
import { WEIGHTED_PRICE_STRATEGY_VALUES } from "../../../lib/weighted-price-strategies"
import { WEIGHTED_CREATION_MODE_VALUES } from "../../../lib/weighted-presentation-profiles"

const AdvancedSettingsSchema = z.object({
    version: z.literal(2).optional(),
    migration_status: z.enum(["native_v2", "migrated_v2"]).optional(),
    matching: z.object({
        priority: z.array(z.enum(MATCH_PRIORITY_VALUES)).optional(),
        similarity_threshold: z.number().min(0).max(1).optional(),
        allow_auto_link: z.boolean().optional(),
        exclude_if_multiple_candidates: z.boolean().optional(),
    }).optional(),
    pricing: z.object({
        default_pvp_field: z.enum(WEIGHTED_PVP_FIELD_VALUES).optional(),
        rounding_mode: z.enum(ROUNDING_MODE_VALUES).optional(),
        markup_percent: z.number().nullable().optional(),
        minimum_price: z.number().nullable().optional(),
    }).optional(),
    weighted: z.object({
        enabled: z.boolean().optional(),
        weight_source: z.literal("variant_weight_with_metadata_override").optional(),
        invoice_grouping: z.literal("group_by_contifico_product").optional(),
        block_if_missing_weight: z.boolean().optional(),
        allow_weighted_price_sync: z.boolean().optional(),
        pricing_strategy: z.enum(WEIGHTED_PRICE_STRATEGY_VALUES).optional(),
        strategy_config: z.union([
            z.object({
                field: z.enum(WEIGHTED_PVP_FIELD_VALUES),
            }),
            z.object({
                fallback_field: z.enum(WEIGHTED_PVP_FIELD_VALUES),
                rules: z.array(
                    z.object({
                        grams: z.number().positive(),
                        field: z.enum(WEIGHTED_PVP_FIELD_VALUES),
                    })
                ),
            }),
        ]).optional(),
        creation_mode: z.enum(WEIGHTED_CREATION_MODE_VALUES).optional(),
        default_profile_id: z.string().nullable().optional(),
        creation_profiles: z.array(
            z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                matcher: z.object({
                    category_ids: z.array(z.string().min(1)).optional(),
                    brand_ids: z.array(z.string().min(1)).optional(),
                    unit_ids: z.array(z.string().min(1)).optional(),
                    code_prefixes: z.array(z.string().min(1)).optional(),
                }).nullable().optional(),
                variants: z.array(
                    z.object({
                        grams: z.number().positive(),
                        pvp_field: z.enum(WEIGHTED_PVP_FIELD_VALUES),
                        label: z.string().nullable().optional(),
                        sku_suffix: z.string().nullable().optional(),
                    })
                ),
            })
        ).optional(),
        pvp_field_by_grams: z.array(
            z.object({
                grams: z.number().positive(),
                field: z.enum(WEIGHTED_PVP_FIELD_VALUES),
            })
        ).optional(),
    }).optional(),
    stock: z.object({
        mode: z.enum(STOCK_MODE_VALUES).optional(),
        mismatch_policy: z.enum(STOCK_MISMATCH_POLICY_VALUES).optional(),
    }).optional(),
    invoicing: z.object({
        on_missing_mapping: z.enum(INVOICE_MISSING_MAPPING_VALUES).optional(),
        on_missing_weighted_data: z.literal("error").optional(),
        reference_template: z.string().min(1).optional(),
        description_template: z.string().min(1).optional(),
    }).optional(),
    delete_policy: z.object({
        product_delete_scope: z.enum(DELETE_SCOPE_VALUES).optional(),
        require_preview: z.boolean().optional(),
    }).optional(),
    sync_behavior: z.object({
        dry_run_enabled: z.boolean().optional(),
        log_decisions: z.boolean().optional(),
    }).optional(),
}).optional()

const ImportFilterRuleSchema = z.object({
    field: z.string().min(1),
    operator: z.enum(FILTER_OPERATOR_VALUES),
    value: z.string().optional(),
    label: z.string().optional(),
    disabled: z.boolean().optional(),
})

const ImportFilterConfigSchema = z.object({
    mode: z.enum(["and", "or"]),
    rules: z.array(ImportFilterRuleSchema),
}).nullable()

export const UpdateContificoConfigSchema = z.object({
    api_key: z.string().min(1, "API Key es requerida"),
    api_pos: z.string().nullable().optional(),
    bodega_ids: z.array(z.string()).optional(),
    sync_products_enabled: z.boolean().optional(),
    sync_customers_enabled: z.boolean().optional(),
    auto_invoice_enabled: z.boolean().optional(),
    auto_preinvoice_enabled: z.boolean().optional(),
    sync_interval_minutes: z.number().min(5).max(1440).optional(),
    manage_inventory: z.boolean().optional(),
    allow_backorder: z.boolean().optional(),
    sales_channel_id: z.string().nullable().optional(),
    shipping_profile_id: z.string().nullable().optional(),
    variant_mode: z.enum(VARIANT_MODE_VALUES).optional(),
    weighted_pvp_field: z.enum(WEIGHTED_PVP_FIELD_VALUES).optional(),
    advanced_settings: AdvancedSettingsSchema,
    invoice_test_mode: z.boolean().optional(),
    import_filters: ImportFilterConfigSchema.optional(),
})

export type UpdateContificoConfigInput = z.infer<typeof UpdateContificoConfigSchema>
export type UpdateContificoImportFilters = ImportFilterConfig
