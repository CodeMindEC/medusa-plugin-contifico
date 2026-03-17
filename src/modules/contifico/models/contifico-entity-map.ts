import { model } from "@medusajs/framework/utils"

/**
 * Mapea entidades entre Medusa y Contifico.
 * Permite saber que producto/cliente de Medusa corresponde a cual en Contifico.
 */
const ContificoEntityMap = model.define("contifico_entity_map", {
    id: model.id().primaryKey(),
    /** Tipo de entidad: "product", "variant", "customer", "category" */
    entity_type: model.text(),
    /** ID en Medusa */
    medusa_id: model.text(),
    /** ID en Contifico */
    contifico_id: model.text(),
    /** Metadata adicional (ej: codigo, etc) */
    metadata: model.json().nullable(),
}).indexes([
    {
        on: ["entity_type", "medusa_id"],
        unique: true,
        where: "deleted_at IS NULL AND entity_type <> 'invoice'",
    },
    {
        on: ["entity_type", "medusa_id"],
        where: "deleted_at IS NULL",
    },
    {
        on: ["entity_type", "medusa_id"],
        unique: true,
        where: "deleted_at IS NULL AND entity_type = 'invoice' AND medusa_id LIKE '%:%'",
    },
    {
        on: ["entity_type", "contifico_id"],
        where: "deleted_at IS NULL",
    },
])

export default ContificoEntityMap
