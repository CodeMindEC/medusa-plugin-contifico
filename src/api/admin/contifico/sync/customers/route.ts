import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ICustomerModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { CONTIFICO_MODULE } from "../../../../../modules/contifico"
import type ContificoModuleService from "../../../../../modules/contifico/service"
import { ContificoClient } from "../../../../../lib/client"
import { normalize } from "../../../../../lib/similarity"
import type { ContificoPersona } from "../../../../../lib/types"

/**
 * POST /admin/contifico/sync/customers
 * Sincroniza clientes desde Contifico → Medusa.
 *
 * - Solo importa personas con es_cliente=true
 * - Usa company_name, phone, addresses reales de Medusa
 * - Guarda cedula/ruc/tipo en metadata
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const started = Date.now()
    let totalProcessed = 0
    let totalErrors = 0
    let totalUpdated = 0
    let totalAutoLinked = 0
    let totalCreated = 0
    let totalSkipped = 0
    const errors: Array<{ persona: string; error: string }> = []

    try {
        // ── Servicios ──────────────────────────────────────
        const contificoService: ContificoModuleService =
            req.scope.resolve(CONTIFICO_MODULE)
        const customerService: ICustomerModuleService =
            req.scope.resolve(Modules.CUSTOMER)

        const [configs] = await contificoService.listAndCountContificoConfigs()
        const config = configs[0]

        if (!config?.api_key) {
            res.status(400).json({ error: "No hay API Key configurada." })
            return
        }

        // ── 1. Traer personas de Contifico ─────────────────
        const client = new ContificoClient({ apiKey: config.api_key })
        const allPersonas = await client.getAllPersonas()

        // Solo clientes (no proveedores, empleados, vendedores, etc.)
        const contificoPersonas = allPersonas.filter((p) => p.es_cliente)

        // ── 2. Mapeos existentes ───────────────────────────
        const [existingMaps] =
            await contificoService.listAndCountContificoEntityMaps({
                entity_type: "customer",
            })
        const mapByContifico = new Map(
            existingMaps.map((m) => [m.contifico_id, m])
        )
        const mapByMedusa = new Set(existingMaps.map((m) => m.medusa_id))

        // ── 3. Clientes de Medusa ──────────────────────────
        const [medusaCustomers] = await customerService.listAndCountCustomers(
            {},
            { take: 5000, relations: ["addresses"] }
        )

        // Índice por email normalizado
        const medusaByEmail = new Map<string, (typeof medusaCustomers)[0]>()
        for (const mc of medusaCustomers) {
            if (mc.email) {
                medusaByEmail.set(normalize(mc.email), mc)
            }
        }

        // ── Helpers ────────────────────────────────────────
        function parseNombres(persona: ContificoPersona) {
            const rs = (persona.razon_social || "").trim()
            // Para personas jurídicas, todo va en first_name
            if (persona.tipo === "J") {
                return { first_name: rs || "Empresa", last_name: "" }
            }
            const parts = rs.split(/\s+/)
            if (parts.length >= 2) {
                return { first_name: parts[0], last_name: parts.slice(1).join(" ") }
            }
            return { first_name: rs || "Cliente", last_name: "" }
        }

        function buildMetadata(persona: ContificoPersona, existing?: Record<string, unknown>) {
            return {
                ...(existing || {}),
                contifico_id: persona.id,
                cedula: persona.cedula || null,
                ruc: persona.ruc || null,
                tipo_persona: persona.tipo,
                es_proveedor: persona.es_proveedor || false,
                nombre_comercial: persona.nombre_comercial || null,
                pvp_default: persona.pvp_default || null,
                dias_credito: persona.dias_credito || null,
                cupo_credito: persona.cupo_credito || null,
            }
        }

        function buildAddress(persona: ContificoPersona) {
            if (!persona.direccion) return null
            return {
                address_name: "Contifico",
                address_1: persona.direccion,
                company: persona.nombre_comercial || persona.razon_social || undefined,
                phone: persona.telefonos || undefined,
                country_code: "ec",
                is_default_shipping: true,
                is_default_billing: true,
            }
        }

        // ── 4. Procesar cada persona ───────────────────────
        for (const cp of contificoPersonas) {
            try {
                const map = mapByContifico.get(cp.id)

                if (map) {
                    // ─── Ya vinculado → actualizar datos completos ───
                    try {
                        const existing = medusaCustomers.find((c) => c.id === map.medusa_id)
                        const { first_name, last_name } = parseNombres(cp)
                        const updateData: Record<string, any> = {
                            first_name,
                            last_name,
                            company_name: cp.nombre_comercial || cp.razon_social || null,
                            phone: cp.telefonos || null,
                            metadata: buildMetadata(cp, (existing as any)?.metadata),
                        }
                        if (cp.email) {
                            updateData.email = cp.email
                        }

                        await customerService.updateCustomers(map.medusa_id, updateData)

                        // Crear/actualizar dirección real
                        const addr = buildAddress(cp)
                        if (addr) {
                            try {
                                const existingAddrs = (existing as any)?.addresses || []
                                const contificoAddr = existingAddrs.find(
                                    (a: any) => a.address_name === "Contifico"
                                )
                                if (contificoAddr) {
                                    await customerService.updateCustomerAddresses(
                                        contificoAddr.id,
                                        addr
                                    )
                                } else {
                                    await customerService.createCustomerAddresses({
                                        ...addr,
                                        customer_id: map.medusa_id,
                                    })
                                }
                            } catch {
                                // No fallar sync por error de dirección
                            }
                        }

                        totalUpdated++
                    } catch (updateErr) {
                        errors.push({
                            persona: cp.razon_social || cp.id,
                            error: `Update: ${(updateErr as Error).message}`,
                        })
                        totalErrors++
                    }
                } else {
                    // ─── Sin mapeo → buscar por email o crear ───
                    let medusaId: string | null = null

                    // Buscar por email
                    if (cp.email) {
                        const emailNorm = normalize(cp.email)
                        const match = medusaByEmail.get(emailNorm)
                        if (match && !mapByMedusa.has(match.id)) {
                            medusaId = match.id
                            totalAutoLinked++
                        }
                    }

                    // No encontrado → CREAR nuevo cliente en Medusa
                    if (!medusaId) {
                        try {
                            const { first_name, last_name } = parseNombres(cp)

                            // Si tiene email, verificar que no colisione
                            if (cp.email) {
                                const emailNorm = normalize(cp.email)
                                const existingByEmail = medusaByEmail.get(emailNorm)
                                if (existingByEmail && !mapByMedusa.has(existingByEmail.id)) {
                                    medusaId = existingByEmail.id
                                    totalAutoLinked++
                                } else if (existingByEmail) {
                                    totalSkipped++
                                    totalProcessed++
                                    continue
                                }
                            }

                            // Crear si no se vinculó arriba
                            if (!medusaId) {
                                const addr = buildAddress(cp)
                                const created = await customerService.createCustomers({
                                    first_name,
                                    last_name,
                                    email: cp.email || null,
                                    phone: cp.telefonos || null,
                                    company_name: cp.nombre_comercial || cp.razon_social || null,
                                    metadata: buildMetadata(cp),
                                    addresses: addr ? [addr] : undefined,
                                })

                                medusaId = created.id
                                totalCreated++

                                if (cp.email) {
                                    medusaByEmail.set(normalize(cp.email), created as any)
                                }
                            }
                        } catch (createErr) {
                            errors.push({
                                persona: cp.razon_social || cp.id,
                                error: `Create: ${(createErr as Error).message}`,
                            })
                            totalErrors++
                            totalProcessed++
                            continue
                        }
                    }

                    // Vincular en entity_map
                    if (medusaId) {
                        try {
                            await contificoService.createContificoEntityMaps({
                                entity_type: "customer",
                                medusa_id: medusaId,
                                contifico_id: cp.id,
                                metadata: {
                                    cedula: cp.cedula || null,
                                    ruc: cp.ruc || null,
                                    auto_linked: true,
                                },
                            })
                            mapByMedusa.add(medusaId)
                        } catch (linkErr) {
                            errors.push({
                                persona: cp.razon_social || cp.id,
                                error: `Link: ${(linkErr as Error).message}`,
                            })
                            totalErrors++
                        }
                    }
                }

                totalProcessed++
            } catch (err) {
                errors.push({
                    persona: cp.razon_social || cp.id,
                    error: (err as Error).message,
                })
                totalErrors++
            }
        }

        // ── 5. Actualizar last_customer_sync ───────────────
        await contificoService.updateContificoConfigs({
            id: config.id,
            last_customer_sync: new Date().toISOString(),
        })

        // ── 6. Registrar log ───────────────────────────────
        const duration = Date.now() - started
        const totalActualizadosYCreados = totalCreated + totalUpdated

        await contificoService.createContificoSyncLogs({
            sync_type: "customers",
            status: totalErrors > 0 ? "partial" : "success",
            total_processed: totalActualizadosYCreados,
            total_errors: totalErrors,
            duration_ms: duration,
            started_at: new Date(started).toISOString(),
            details: {
                trigger: "manual",
                contifico_total: allPersonas.length,
                clientes_filtrados: contificoPersonas.length,
                no_clientes_omitidos: allPersonas.length - contificoPersonas.length,
                created: totalCreated,
                auto_linked: totalAutoLinked,
                updated: totalUpdated,
                skipped: totalSkipped,
                errors: errors.slice(0, 20),
            },
        })

        const msg = [
            totalCreated > 0 ? `${totalCreated} creados` : null,
            totalUpdated > 0 ? `${totalUpdated} actualizados` : null,
            totalErrors > 0 ? `${totalErrors} errores` : null,
        ].filter(Boolean).join(", ")

        res.json({
            message: `Sync completado: ${msg || 'sin cambios'}`,
            stats: {
                processed: totalActualizadosYCreados,
                created: totalCreated,
                updated: totalUpdated,
                errors: totalErrors,
                duration_ms: duration,
            },
        })
    } catch (error) {
        const duration = Date.now() - started
        try {
            const service: ContificoModuleService =
                req.scope.resolve(CONTIFICO_MODULE)
            await service.createContificoSyncLogs({
                sync_type: "customers",
                status: "error",
                total_processed: totalProcessed,
                total_errors: totalErrors + 1,
                duration_ms: duration,
                started_at: new Date(started).toISOString(),
                details: {
                    trigger: "manual",
                    fatal: (error as Error).message,
                },
            })
        } catch {
            // noop
        }

        res.status(500).json({
            error: `Error en sync: ${(error as Error).message}`,
        })
    }
}
