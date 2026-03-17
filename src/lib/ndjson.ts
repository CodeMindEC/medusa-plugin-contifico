import type { MedusaResponse } from "@medusajs/framework/http"

export interface NdjsonProgressEvent {
    type: "progress"
    phase: string
    message: string
    percent: number
}

export interface NdjsonResultEvent<TData> {
    type: "result"
    data: TData
}

export type NdjsonEvent<TData> = NdjsonProgressEvent | NdjsonResultEvent<TData>

export interface NdjsonStream<TData> {
    progress: (phase: string, message: string, percent: number) => void
    result: (data: TData) => void
    error: (message: string) => void
}

export function createNdjsonStream<TData>(
    res: MedusaResponse
): NdjsonStream<TData> {
    res.setHeader("Content-Type", "application/x-ndjson")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("X-Accel-Buffering", "no")
    res.setHeader("Connection", "keep-alive")
    res.flushHeaders()

    return {
        progress: (phase, message, percent) => {
            writeNdjson(res, {
                type: "progress",
                phase,
                message,
                percent: Math.min(percent, 99),
            })
        },
        result: (data) => {
            writeNdjson(res, { type: "result", data })
            res.end()
        },
        error: (message) => {
            writeNdjson(res, { type: "result", data: { error: message } as TData })
            res.end()
        },
    }
}

function writeNdjson<TData>(res: MedusaResponse, event: NdjsonEvent<TData>) {
    try {
        res.write(`${JSON.stringify(event)}\n`)
    } catch {
        // Ignore streaming write errors.
    }
}
