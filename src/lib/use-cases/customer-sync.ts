import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ICustomerModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type ContificoModuleService from "../../modules/contifico/service"
import { ContificoClient } from "../client"
import { getContificoService } from "../../api/admin/contifico/shared"
import { getContificoConfig } from "../../api/admin/contifico/shared"
import { createCorrelationId, isUniqueConstraintError, logContificoEvent } from "../observability"
import { normalize } from "../similarity"
import type { ContificoPersona } from "../types"

interface CustomerSyncStats {
    processed: number
    created: number
    updated: number
    auto_linked: number
    recovered_links: number
    skipped: number
    errors: number
    duration_ms: number
}

interface ExistingCustomerSnapshot {
    metadata?: Record<string, unknown>
    addresses?: Array<Record<string, unknown>>
}

export async function runCustomerSync(req: MedusaRequest, res: MedusaResponse) {
    const started = Date.now()
    const correlationId = createCorrelationId("contifico_customer_sync")
    let totalProcessed = 0
    let totalErrors = 0
    let totalUpdated = 0
    let totalAutoLinked = 0
    let totalRecoveredLinks = 0
    let totalCreated = 0
    let totalSkipped = 0
    const errors: Array<{ persona: string; error: string }> = []

    try {
        const contificoService: ContificoModuleService = getContificoService(req.scope)
        const customerService: ICustomerModuleService = req.scope.resolve(Modules.CUSTOMER)
        const { normalized: config } = await getContificoConfig(contificoService)

        if (!config?.api_key) {
            res.status(400).json({ error: "No hay API Key configurada." })
            return
        }

        const client = new ContificoClient({ apiKey: config.api_key })
        const allPersonas = await client.getAllPersonas()
        const contificoPersonas = allPersonas.filter((p) => p.es_cliente)

        const [existingMaps] = await contificoService.listAndCountContificoEntityMaps({
            entity_type: "customer",
        })
        const mapByContifico = new Map(existingMaps.map((m) => [m.contifico_id, m]))
        const mapByMedusa = new Set(existingMaps.map((m) => m.medusa_id))

        const [medusaCustomers] = await customerService.listAndCountCustomers(
            {},
            { take: 5000, relations: ["addresses"] }
        )
        const medusaByEmail = new Map<string, (typeof medusaCustomers)[0]>()
        for (const mc of medusaCustomers) {
            if (mc.email) {
                medusaByEmail.set(normalize(mc.email), mc)
            }
        }

        for (const cp of contificoPersonas) {
            try {
                const map = mapByContifico.get(cp.id)

                if (map) {
                    try {
                        const existing = medusaCustomers.find(
                            (c) => c.id === map.medusa_id
                        ) as ExistingCustomerSnapshot | undefined
                        const { first_name, last_name } = parseNombres(cp)
                        const updateData: Record<string, unknown> = {
                            first_name,
                            last_name,
                            company_name: cp.nombre_comercial || cp.razon_social || null,
                            phone: cp.telefonos || null,
                            metadata: buildMetadata(
                                cp,
                                existing?.metadata
                            ),
                        }
                        if (cp.email) {
                            updateData.email = cp.email
                        }

                        await customerService.updateCustomers(map.medusa_id, updateData)
                        const addr = buildAddress(cp)
                        if (addr) {
                            await upsertCustomerAddress(customerService, existing, map.medusa_id, addr)
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
                    let medusaId: string | null = null
                    let createdCustomerId: string | null = null

                    if (cp.email) {
                        const match = medusaByEmail.get(normalize(cp.email))
                        if (match && !mapByMedusa.has(match.id)) {
                            medusaId = match.id
                            totalAutoLinked++
                        }
                    }

                    if (!medusaId) {
                        try {
                            const { first_name, last_name } = parseNombres(cp)

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

                            if (!medusaId) {
                                const addr = buildAddress(cp)
                                const created = await customerService.createCustomers({
                                    first_name,
                                    last_name,
                                    email: cp.email || null,
                                    phone: cp.telefonos || null,
                                    company_name:
                                        cp.nombre_comercial || cp.razon_social || null,
                                    metadata: buildMetadata(cp),
                                    addresses: addr ? [addr] : undefined,
                                })

                                medusaId = created.id
                                createdCustomerId = created.id
                                totalCreated++

                                if (cp.email) {
                                    medusaByEmail.set(
                                        normalize(cp.email),
                                        created as (typeof medusaCustomers)[0]
                                    )
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
                                    correlation_id: correlationId,
                                },
                            })
                            mapByMedusa.add(medusaId)
                        } catch (linkErr) {
                            const recovered = await recoverCustomerLinkFailure({
                                contificoService,
                                customerService,
                                contificoPersona: cp,
                                medusaId,
                                createdCustomerId,
                                correlationId,
                                error: linkErr,
                            })

                            if (recovered) {
                                mapByMedusa.add(recovered.medusa_id)
                                mapByContifico.set(cp.id, recovered)
                                totalRecoveredLinks++
                            } else {
                                errors.push({
                                    persona: cp.razon_social || cp.id,
                                    error: `Link: ${(linkErr as Error).message}`,
                                })
                                totalErrors++
                            }
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

        await contificoService.updateContificoConfigs({
            id: config.id,
            last_customer_sync: new Date().toISOString(),
        })

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
                correlation_id: correlationId,
                trigger: "manual",
                contifico_total: allPersonas.length,
                clientes_filtrados: contificoPersonas.length,
                no_clientes_omitidos: allPersonas.length - contificoPersonas.length,
                created: totalCreated,
                auto_linked: totalAutoLinked,
                recovered_links: totalRecoveredLinks,
                updated: totalUpdated,
                skipped: totalSkipped,
                errors: errors.slice(0, 20),
            },
        })

        logContificoEvent("info", "Customer sync completed", {
            correlation_id: correlationId,
            operation: "customer_sync.run",
            processed: totalActualizadosYCreados,
            errors: totalErrors,
            duration_ms: duration,
        })

        res.json({
            message: buildCustomerSyncMessage({
                processed: totalActualizadosYCreados,
                created: totalCreated,
                updated: totalUpdated,
                auto_linked: totalAutoLinked,
                recovered_links: totalRecoveredLinks,
                skipped: totalSkipped,
                errors: totalErrors,
                duration_ms: duration,
            }),
            stats: {
                processed: totalActualizadosYCreados,
                created: totalCreated,
                updated: totalUpdated,
                auto_linked: totalAutoLinked,
                recovered_links: totalRecoveredLinks,
                errors: totalErrors,
                duration_ms: duration,
            },
        })
    } catch (error) {
        const duration = Date.now() - started
        try {
            const service: ContificoModuleService = getContificoService(req.scope)
            await service.createContificoSyncLogs({
                sync_type: "customers",
                status: "error",
                total_processed: totalProcessed,
                total_errors: totalErrors + 1,
                duration_ms: duration,
                started_at: new Date(started).toISOString(),
                details: {
                    correlation_id: correlationId,
                    trigger: "manual",
                    fatal: (error as Error).message,
                },
            })
        } catch {
            // noop
        }

        logContificoEvent(
            "error",
            "Customer sync failed",
            {
                correlation_id: correlationId,
                operation: "customer_sync.run",
                duration_ms: duration,
            },
            error
        )

        res.status(500).json({
            error: `Error en sync: ${(error as Error).message}`,
        })
    }
}

export async function recoverCustomerLinkFailure(input: {
    contificoService: Pick<
        ContificoModuleService,
        "listContificoEntityMaps"
    >
    customerService: unknown
    contificoPersona: Pick<ContificoPersona, "id" | "razon_social">
    medusaId: string
    createdCustomerId: string | null
    correlationId: string
    error: unknown
}) {
    const existingByContifico = await input.contificoService.listContificoEntityMaps({
        entity_type: "customer",
        contifico_id: input.contificoPersona.id,
    })
    if (existingByContifico[0]) {
        await cleanupOrphanCustomerIfNeeded(
            input.customerService,
            input.createdCustomerId,
            existingByContifico[0].medusa_id,
            input.correlationId
        )
        return existingByContifico[0]
    }

    const existingByMedusa = await input.contificoService.listContificoEntityMaps({
        entity_type: "customer",
        medusa_id: input.medusaId,
    })
    if (existingByMedusa[0] && isUniqueConstraintError(input.error)) {
        await cleanupOrphanCustomerIfNeeded(
            input.customerService,
            input.createdCustomerId,
            existingByMedusa[0].medusa_id,
            input.correlationId
        )
        return existingByMedusa[0]
    }

    await cleanupOrphanCustomerIfNeeded(
        input.customerService,
        input.createdCustomerId,
        null,
        input.correlationId
    )
    return null
}

export async function cleanupOrphanCustomerIfNeeded(
    customerService: unknown,
    createdCustomerId: string | null,
    mappedCustomerId: string | null,
    correlationId: string
) {
    if (!createdCustomerId || createdCustomerId === mappedCustomerId) {
        return
    }

    try {
        const service = customerService as {
            deleteCustomers?: (ids: string[]) => Promise<unknown>
        }
        await service.deleteCustomers?.([createdCustomerId])
        logContificoEvent("warn", "Orphan customer cleaned after link failure", {
            correlation_id: correlationId,
            operation: "customer_sync.cleanup_orphan",
            medusa_id: createdCustomerId,
        })
    } catch (error) {
        logContificoEvent(
            "error",
            "Failed to clean orphan customer after link failure",
            {
                correlation_id: correlationId,
                operation: "customer_sync.cleanup_orphan",
                medusa_id: createdCustomerId,
            },
            error
        )
    }
}

export function buildCustomerSyncMessage(stats: CustomerSyncStats): string {
    const parts = [
        stats.created > 0 ? `${stats.created} creados` : null,
        stats.updated > 0 ? `${stats.updated} actualizados` : null,
        stats.recovered_links > 0 ? `${stats.recovered_links} recuperados` : null,
        stats.errors > 0 ? `${stats.errors} errores` : null,
    ].filter(Boolean)

    return `Sync completado: ${parts.join(", ") || "sin cambios"}`
}

function parseNombres(persona: ContificoPersona) {
    const rs = (persona.razon_social || "").trim()
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

async function upsertCustomerAddress(
    customerService: ICustomerModuleService,
    existingCustomer: ExistingCustomerSnapshot | undefined,
    customerId: string,
    address: Record<string, unknown>
) {
    try {
        const existingAddrs =
            (existingCustomer?.addresses as Array<Record<string, unknown>>) || []
        const contificoAddr = existingAddrs.find(
            (a) => a.address_name === "Contifico"
        )
        if (contificoAddr) {
            await customerService.updateCustomerAddresses(
                contificoAddr.id as string,
                address
            )
        } else {
            await customerService.createCustomerAddresses({
                ...address,
                customer_id: customerId,
            })
        }
    } catch {
        // No bloquear el sync por dirección.
    }
}
