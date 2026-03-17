import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { UpdateContificoConfigSchema } from "../validators"
import {
    normalizeAdvancedSettings,
    type AdvancedContificoSettings,
} from "../../../../lib/advanced-settings"
import {
    serializeContificoConfigInput,
} from "../../../../lib/contifico-config"
import { createCorrelationId, logContificoEvent } from "../../../../lib/observability"
import { getContificoConfig, getContificoService } from "../shared"

/**
 * GET /admin/contifico/config
 * Obtiene la configuracion actual de Contifico.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const service = getContificoService(req.scope)
    const { normalized } = await getContificoConfig(service)
    res.json({ config: normalized })
}

/**
 * POST /admin/contifico/config
 * Crea o actualiza la configuracion de Contifico.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const correlationId = createCorrelationId("contifico_config_save")
    const parsed = UpdateContificoConfigSchema.safeParse(req.body)

    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() })
        return
    }

    const service = getContificoService(req.scope)
    const [existing] = await service.listAndCountContificoConfigs()
    const weightedPvpField =
        parsed.data.weighted_pvp_field ||
        (parsed.data.advanced_settings
            ? normalizeAdvancedSettings(
                  parsed.data.advanced_settings as Partial<AdvancedContificoSettings>
              ).pricing.default_pvp_field
            : undefined)
    const normalizedAdvancedSettings = parsed.data.advanced_settings
        ? normalizeAdvancedSettings(
              {
                  ...(parsed.data.advanced_settings as Partial<AdvancedContificoSettings>),
                  weighted: {
                      ...(
                          (parsed.data.advanced_settings as Partial<AdvancedContificoSettings>)
                              .weighted || {}
                      ),
                      enabled: parsed.data.variant_mode === "weighted",
                  },
              },
              {
                  default_weighted_pvp_field: weightedPvpField,
                  default_weighted_enabled: parsed.data.variant_mode === "weighted",
              }
          )
        : undefined
    const dataToSave = serializeContificoConfigInput({
        ...parsed.data,
        weighted_pvp_field: weightedPvpField,
        advanced_settings: normalizedAdvancedSettings,
    })

    try {
        let config
        if (existing.length > 0) {
            // Actualizar config existente
            config = await service.updateContificoConfigs(
                { id: existing[0].id, ...dataToSave }
            )
        } else {
            // Crear nueva config
            config = await service.createContificoConfigs(dataToSave)
        }

        // Devolver bodega_ids como array e import_filters como objeto
        res.json({
            config: (await getContificoConfig(service)).normalized,
        })
    } catch (err) {
        logContificoEvent(
            "error",
            "Error guardando configuración",
            {
                correlation_id: correlationId,
                operation: "config.save",
            },
            err
        )
        res.status(500).json({
            error:
                err instanceof Error
                    ? err.message
                    : "Error interno al guardar configuracion. Verifica que las migraciones esten al dia.",
        })
    }
}
