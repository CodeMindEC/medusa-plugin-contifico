import { afterEach, describe, expect, it, vi } from "vitest"
import {
    bindContificoLogger,
    logContificoEvent,
    resetContificoLogger,
} from "./observability"

describe("observability", () => {
    afterEach(() => {
        resetContificoLogger()
    })

    it("binds and uses a container logger when one is available", () => {
        const info = vi.fn()
        const warn = vi.fn()
        const error = vi.fn()

        bindContificoLogger({
            resolve: vi.fn().mockImplementation((key: string) =>
                key === "logger" ? { info, warn, error } : undefined
            ),
        })

        logContificoEvent("info", "Test event", {
            correlation_id: "corr_1",
            operation: "test.operation",
        })

        expect(info).toHaveBeenCalledWith("[Contifico] Test event", {
            message: "Test event",
            correlation_id: "corr_1",
            operation: "test.operation",
        })
    })
})
