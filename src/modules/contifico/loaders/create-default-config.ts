import type {
    LoaderOptions,
    IMedusaInternalService,
} from "@medusajs/framework/types"
import ContificoConfig from "../models/contifico-config"
import { createCorrelationId, logContificoEvent } from "../../../lib/observability"

/**
 * Crea un registro de configuracion por defecto si no existe ninguno.
 * Se ejecuta al iniciar Medusa.
 *
 * NOTA: Los loaders reciben el contenedor INTERNO del modulo, donde
 * el servicio principal aun no esta registrado. Usamos el servicio
 * interno auto-generado por modelo: "contificoConfigService".
 */
export default async function createDefaultConfigLoader({
    container,
}: LoaderOptions) {
    const correlationId = createCorrelationId("contifico_loader")
    try {
        const service: IMedusaInternalService<typeof ContificoConfig> =
            container.resolve("contificoConfigService")

        const [, count] = await service.listAndCount()

        if (count > 0) return

        await service.create({
            api_key: "",
            api_pos: null,
            bodega_ids: null,
            sync_products_enabled: false,
            sync_customers_enabled: false,
            auto_invoice_enabled: false,
            sync_interval_minutes: 60,
            manage_inventory: false,
            allow_backorder: false,
            sales_channel_id: null,
            shipping_profile_id: null,
            variant_mode: "auto",
            last_product_sync: null,
            last_customer_sync: null,
        })

        logContificoEvent("info", "Configuración por defecto creada", {
            correlation_id: correlationId,
            operation: "loader.create_default_config",
        })
    } catch (error) {
        logContificoEvent(
            "error",
            "Error creando configuración por defecto",
            {
                correlation_id: correlationId,
                operation: "loader.create_default_config",
            },
            error
        )
    }
}
