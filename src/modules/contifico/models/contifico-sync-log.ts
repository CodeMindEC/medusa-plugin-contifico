import { model } from "@medusajs/framework/utils"

/**
 * Registro de cada sincronizacion ejecutada.
 */
const ContificoSyncLog = model.define("contifico_sync_log", {
    id: model.id().primaryKey(),
    /** Tipo de sync: "products", "stock", "customers", "invoice" */
    sync_type: model.text(),
    /** "success", "partial", "error" */
    status: model.text(),
    /** Total de registros procesados */
    total_processed: model.number().default(0),
    /** Total de errores */
    total_errors: model.number().default(0),
    /** Detalles / errores en JSON */
    details: model.json().nullable(),
    /** Duracion en ms */
    duration_ms: model.number().default(0),
    /** Momento del sync (se usa created_at, pero guardamos tambien explicitamente) */
    started_at: model.text(),
})

export default ContificoSyncLog
