import { beforeEach, describe, expect, it, vi } from "vitest"

const {
    mockEnsureQueuedSyncRun,
    mockGetContificoConfig,
    mockGetContificoService,
    mockEmit,
} = vi.hoisted(() => ({
    mockEnsureQueuedSyncRun: vi.fn(),
    mockGetContificoConfig: vi.fn(),
    mockGetContificoService: vi.fn(),
    mockEmit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../contifico-sync-runs", () => ({
    ensureQueuedSyncRun: mockEnsureQueuedSyncRun,
    completeSyncRun: vi.fn(),
    failSyncRun: vi.fn(),
    markSyncRunRunning: vi.fn(),
    readLogCorrelationId: vi.fn(),
}))

vi.mock("../../api/admin/contifico/shared", () => ({
    getContificoConfig: mockGetContificoConfig,
    getContificoService: mockGetContificoService,
}))

import { runProductStockSync, runProductSync } from "./product-sync"

describe("product sync enqueue routes", () => {
    const contificoService = {}
    const res = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
    }
    const req = {
        protocol: "http",
        get: vi.fn().mockReturnValue("localhost:9000"),
        scope: {
            resolve: vi.fn((key: string) => {
                if (key === "event_bus" || key === "eventBusService" || key === "event-bus") {
                    return { emit: mockEmit }
                }
                return { emit: mockEmit }
            }),
        },
    }

    beforeEach(() => {
        vi.clearAllMocks()
        mockGetContificoService.mockReturnValue(contificoService)
        mockGetContificoConfig.mockResolvedValue({
            normalized: { id: "cfg_1", sync_products_enabled: true },
        })
    })

    it("queues a new products sync and emits a single event", async () => {
        mockEnsureQueuedSyncRun.mockResolvedValue({
            id: "log_products_1",
            status: "queued",
            created: true,
        })

        await runProductSync(req as never, res as never)

        expect(mockEnsureQueuedSyncRun).toHaveBeenCalledWith(
            expect.objectContaining({
                service: contificoService,
                sync_type: "products",
                config_id: "cfg_1",
            })
        )
        expect(mockEmit).toHaveBeenCalledWith({
            name: "contifico.products.sync.requested",
            data: expect.objectContaining({
                log_id: "log_products_1",
                config_id: "cfg_1",
                request_base_url: "http://localhost:9000",
            }),
        })
        expect(res.json).toHaveBeenCalledWith({
            log_id: "log_products_1",
            sync_type: "products",
            status: "queued",
        })
    })

    it("returns the existing stock run without emitting a duplicate event", async () => {
        mockEnsureQueuedSyncRun.mockResolvedValue({
            id: "log_stock_1",
            status: "running",
            created: false,
        })

        await runProductStockSync(req as never, res as never)

        expect(mockEmit).not.toHaveBeenCalled()
        expect(res.json).toHaveBeenCalledWith({
            log_id: "log_stock_1",
            sync_type: "products-stock",
            status: "running",
        })
    })
})
