import type { ProgressState } from "./types"

interface ProgressEnvelope {
    type: "progress"
    phase: string
    message: string
    percent: number
}

interface ResultEnvelope<TData> {
    type: "result"
    data: TData
}

type NdjsonEnvelope<TData> = ProgressEnvelope | ResultEnvelope<TData>

export async function readNDJSONStream<TData>(
    response: Response,
    onProgress: (progress: ProgressState) => void
): Promise<TData | null> {
    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
        return (await response.json()) as TData
    }

    const reader = response.body?.getReader()
    if (!reader) {
        return parseNdjsonText<TData>(await response.text(), onProgress)
    }

    const decoder = new TextDecoder()
    let buffer = ""
    let result: TData | null = null

    while (true) {
        const { done, value } = await reader.read()
        if (done) {
            break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
            result = readNdjsonLine(line, onProgress, result)
        }
    }

    if (buffer.trim()) {
        result = readNdjsonLine(buffer, onProgress, result)
    }

    return result
}

function parseNdjsonText<TData>(
    text: string,
    onProgress: (progress: ProgressState) => void
): TData | null {
    let result: TData | null = null

    for (const line of text.split("\n")) {
        result = readNdjsonLine(line, onProgress, result)
    }

    return result
}

function readNdjsonLine<TData>(
    line: string,
    onProgress: (progress: ProgressState) => void,
    current: TData | null
): TData | null {
    if (!line.trim()) {
        return current
    }

    try {
        const message = JSON.parse(line) as NdjsonEnvelope<TData> | TData
        if (isProgressEnvelope(message)) {
            onProgress(message)
            return current
        }
        if (isResultEnvelope<TData>(message)) {
            return message.data
        }
        return message as TData
    } catch {
        return current
    }
}

function isProgressEnvelope(value: unknown): value is ProgressEnvelope {
    return !!value && typeof value === "object" && (value as ProgressEnvelope).type === "progress"
}

function isResultEnvelope<TData>(value: unknown): value is ResultEnvelope<TData> {
    return !!value && typeof value === "object" && (value as ResultEnvelope<TData>).type === "result"
}
