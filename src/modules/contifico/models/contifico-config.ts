import { model } from "@medusajs/framework/utils"

const ContificoConfig = model.define("contifico_config", {
    id: model.id().primaryKey(),
    api_key: model.text(),
    api_pos: model.text().nullable(),
    /** IDs de las bodegas separados por coma (ej: "id1,id2,id3") */
    bodega_ids: model.text().nullable(),
    /** Sincronizar productos automaticamente */
    sync_products_enabled: model.boolean().default(false),
    /** Sincronizar clientes automaticamente */
    sync_customers_enabled: model.boolean().default(false),
    /** Crear facturas automaticamente al completar pago */
    auto_invoice_enabled: model.boolean().default(false),
    /** Crear prefacturas automaticamente al crear orden */
    auto_preinvoice_enabled: model.boolean().default(false),
    /** Intervalo de sincronizacion en minutos */
    sync_interval_minutes: model.number().default(60),
    /** Habilitar "gestionar inventario" en variantes sincronizadas */
    manage_inventory: model.boolean().default(false),
    /** Permitir pedidos pendientes (backorder) en variantes sincronizadas */
    allow_backorder: model.boolean().default(false),
    /** ID del canal de ventas para productos sincronizados */
    sales_channel_id: model.text().nullable(),
    /** ID del perfil de envío para productos sincronizados */
    shipping_profile_id: model.text().nullable(),
    /** Modo de mapeo: auto | contifico | simple | weighted */
    variant_mode: model.text().default("auto"),
    /** Campo PVP por defecto usado por el modo weighted */
    weighted_pvp_field: model.text().default("pvp1"),
    /** Configuración avanzada del plugin (JSON serializado) */
    advanced_settings: model.text().nullable(),
    /** Filtros de importación de productos (JSON serializado de ImportFilterConfig) */
    import_filters: model.text().nullable(),
    /** Modo de prueba para facturación (genera docs con ref MEDUSA-TEST-*) */
    invoice_test_mode: model.boolean().default(false),
    /** Ultimo sync exitoso de productos (ISO string) */
    last_product_sync: model.text().nullable(),
    /** Ultimo sync exitoso de clientes (ISO string) */
    last_customer_sync: model.text().nullable(),
})

export default ContificoConfig

