import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    buildDocumentoFromOrder,
    calculateOrderTotalsFromOrder,
    getRequiredInvoiceConfig,
    ORDER_INVOICE_GRAPH_FIELDS,
    type InvoiceOrderGraph,
} from "../shared"
import { getContificoService } from "../../shared"
import { getWeightedPriceStrategyExplanation } from "../../../../../lib/advanced-settings"
import type { RulesByWeightStrategyConfig } from "../../../../../lib/weighted-price-strategies"

interface InvoiceQueryService {
    graph<TData>(input: {
        entity: string
        fields: string[]
        filters?: Record<string, unknown>
    }): Promise<{ data: TData[] }>
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const service = getContificoService(req.scope)
    const config = await getRequiredInvoiceConfig(service)

    if (!config) {
        res.status(400).json({
            ok: false,
            summary: {},
            decisions: [],
            warnings: [],
            blockers: ["Configura la API Key de Contífico primero."],
        })
        return
    }

    const { order_id, tipo_documento = "FAC" } = req.body as {
        order_id?: string
        tipo_documento?: "PRE" | "FAC"
    }

    if (!order_id) {
        res.status(400).json({
            ok: false,
            summary: {},
            decisions: [],
            warnings: [],
            blockers: ["order_id es requerido para simular la factura."],
        })
        return
    }

    try {
        const query = req.scope.resolve("query") as InvoiceQueryService
        const { data } = await query.graph<InvoiceOrderGraph>({
            entity: "order",
            fields: [...ORDER_INVOICE_GRAPH_FIELDS],
            filters: { id: order_id },
        })

        const order = data[0]
        if (!order) {
            res.status(404).json({
                ok: false,
                summary: {},
                decisions: [],
                warnings: [],
                blockers: [`Orden ${order_id} no encontrada.`],
            })
            return
        }

        const payload = await buildDocumentoFromOrder(order, tipo_documento, service, config)
        const weightedExplanation = getWeightedPriceStrategyExplanation(
            config.advanced_settings.weighted
        )
        const orderTotals = calculateOrderTotalsFromOrder(order)
        const warnings = buildPreviewWarnings(orderTotals.subtotal, payload.subtotal_12, config)
        res.json({
            ok: true,
            summary: {
                referencia: payload.referencia,
                descripcion: payload.descripcion,
                tipo_documento,
                detalles: payload.detalles.length,
                subtotal_12: payload.subtotal_12,
                iva: payload.iva,
                total: payload.total,
            },
            decisions: [
                {
                    strategy: "pricing:weighted_invoice_source",
                    value:
                        config.sync_products_enabled &&
                        config.advanced_settings.weighted.allow_weighted_price_sync
                            ? "contifico_default"
                            : "medusa_order",
                    reason:
                        config.sync_products_enabled &&
                        config.advanced_settings.weighted.allow_weighted_price_sync
                            ? "En modo weighted, Contifico es la fuente oficial por defecto; cada producto puede desactivar ese bloqueo."
                            : "En modo weighted, se conserva el total del pedido de Medusa.",
                },
                {
                    strategy: "pricing:default_pvp_field",
                    value: config.advanced_settings.pricing.default_pvp_field,
                    reason: "PVP por defecto efectivo",
                },
                {
                    strategy: "pricing:weighted_strategy",
                    value: config.advanced_settings.weighted.pricing_strategy,
                    reason: "Estrategia efectiva para resolver el PVP en modo weighted",
                },
                {
                    strategy: "pricing:weighted_strategy_config",
                    value: config.advanced_settings.weighted.strategy_config,
                    reason: "Configuración efectiva de la estrategia weighted",
                },
                {
                    strategy: "pricing:weighted_strategy_explanation",
                    value: weightedExplanation,
                    reason: "Fallback, reglas y resumen de la estrategia weighted efectiva",
                },
                {
                    strategy: "invoicing:reference_template",
                    value: config.advanced_settings.invoicing.reference_template,
                    reason: "Template de referencia efectivo",
                },
                {
                    strategy: "invoicing:description_template",
                    value: config.advanced_settings.invoicing.description_template,
                    reason: "Template de descripción efectivo",
                },
            ],
            warnings,
            blockers: [],
            payload,
        })
    } catch (error) {
        res.status(500).json({
            ok: false,
            summary: {},
            decisions: [],
            warnings: [],
            blockers: [error instanceof Error ? error.message : "Error generando preview"],
        })
    }
}

function buildPreviewWarnings(
    orderSubtotal: number,
    payloadSubtotal: number,
    config: NonNullable<Awaited<ReturnType<typeof getRequiredInvoiceConfig>>>
) {
    const warnings: string[] = []
    const weightedSettings = config.advanced_settings.weighted

    if (
        config.sync_products_enabled &&
        weightedSettings.allow_weighted_price_sync &&
        orderSubtotal !== payloadSubtotal
    ) {
        warnings.push(
            `El subtotal del pedido en Medusa es ${orderSubtotal.toFixed(2)} y el subtotal del payload es ${payloadSubtotal.toFixed(2)}. Con la configuración actual weighted se están usando precios oficiales de Contífico.`
        )
    }

    if (weightedSettings.pricing_strategy === "rules_by_weight") {
        const strategyConfig =
            weightedSettings.strategy_config as RulesByWeightStrategyConfig
        const ruleGrams = new Set(strategyConfig.rules.map((rule) => rule.grams))
        const profileGrams = new Set(
            weightedSettings.creation_profiles.flatMap((profile) =>
                profile.variants.map((variant) => variant.grams)
            )
        )
        const missingRuleGrams = Array.from(profileGrams).filter(
            (grams) => !ruleGrams.has(grams)
        )

        if (missingRuleGrams.length > 0) {
            warnings.push(
                `Las presentaciones weighted ${missingRuleGrams
                    .sort((left, right) => left - right)
                    .map((grams) => `${grams}g`)
                    .join(", ")} no tienen regla exacta de precio por peso y caerán al fallback ${strategyConfig.fallback_field.toUpperCase()}.`
            )
        }
    }

    return warnings
}
