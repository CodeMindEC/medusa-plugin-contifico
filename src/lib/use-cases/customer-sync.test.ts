import { describe, expect, it, vi } from "vitest"
import {
    cleanupOrphanCustomerIfNeeded,
    recoverCustomerLinkFailure,
} from "./customer-sync"

describe("customer sync use cases", () => {
    it("cleans an orphan customer when link recovery cannot find any map", async () => {
        const deleteCustomers = vi.fn().mockResolvedValue(undefined)
        const result = await recoverCustomerLinkFailure({
            contificoService: {
                listContificoEntityMaps: vi.fn().mockResolvedValue([]),
            } as never,
            customerService: {
                deleteCustomers,
            },
            contificoPersona: {
                id: "per_1",
                razon_social: "Cliente 1",
            },
            medusaId: "cus_created",
            createdCustomerId: "cus_created",
            correlationId: "corr_1",
            error: new Error("network"),
        })

        expect(result).toBeNull()
        expect(deleteCustomers).toHaveBeenCalledWith(["cus_created"])
    })

    it("keeps the mapped customer and skips cleanup when a concurrent map already exists", async () => {
        const deleteCustomers = vi.fn().mockResolvedValue(undefined)
        const result = await recoverCustomerLinkFailure({
            contificoService: {
                listContificoEntityMaps: vi
                    .fn()
                    .mockResolvedValueOnce([
                        {
                            medusa_id: "cus_existing",
                            contifico_id: "per_2",
                        },
                    ]),
            } as never,
            customerService: {
                deleteCustomers,
            },
            contificoPersona: {
                id: "per_2",
                razon_social: "Cliente 2",
            },
            medusaId: "cus_created",
            createdCustomerId: "cus_created",
            correlationId: "corr_2",
            error: new Error("duplicate"),
        })

        expect(result).toEqual({
            medusa_id: "cus_existing",
            contifico_id: "per_2",
        })
        expect(deleteCustomers).toHaveBeenCalledWith(["cus_created"])
    })

    it("does nothing when the created customer is the one that ended up mapped", async () => {
        const deleteCustomers = vi.fn().mockResolvedValue(undefined)
        await cleanupOrphanCustomerIfNeeded(
            { deleteCustomers },
            "cus_same",
            "cus_same",
            "corr_3"
        )

        expect(deleteCustomers).not.toHaveBeenCalled()
    })
})
