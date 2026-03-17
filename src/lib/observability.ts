export type ContificoLogLevel = "info" | "warn" | "error"

export interface ContificoLogContext extends Record<string, unknown> {
    correlation_id: string
    operation: string
}

export interface ContificoLogger {
    info: (message: string, payload: Record<string, unknown>) => void
    warn: (message: string, payload: Record<string, unknown>) => void
    error: (message: string, payload: Record<string, unknown>) => void
}

const DEFAULT_LOGGER: ContificoLogger = {
    info: (message, payload) => {
        console.info(message, payload)
    },
    warn: (message, payload) => {
        console.warn(message, payload)
    },
    error: (message, payload) => {
        console.error(message, payload)
    },
}

let contificoLogger: ContificoLogger = DEFAULT_LOGGER

export function createCorrelationId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`
}

export function setContificoLogger(logger: ContificoLogger) {
    contificoLogger = logger
}

export function resetContificoLogger() {
    contificoLogger = DEFAULT_LOGGER
}

export function bindContificoLogger(scope: {
    resolve?: (key: string) => unknown
}) {
    if (!scope.resolve) {
        return
    }

    try {
        const logger = scope.resolve("logger")
        if (isContificoLogger(logger)) {
            contificoLogger = logger
        }
    } catch {
        // Ignore missing logger registrations and keep fallback behavior.
    }
}

export function logContificoEvent(
    level: ContificoLogLevel,
    message: string,
    context: ContificoLogContext,
    error?: unknown
) {
    const payload = {
        message,
        ...context,
        ...(error
            ? {
                  error: error instanceof Error ? error.message : String(error),
              }
            : {}),
    }

    const formattedMessage = `[Contifico] ${message}`
    if (level === "error") {
        contificoLogger.error(formattedMessage, payload)
        return
    }

    if (level === "warn") {
        contificoLogger.warn(formattedMessage, payload)
        return
    }

    contificoLogger.info(formattedMessage, payload)
}

export function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}

export function isUniqueConstraintError(error: unknown): boolean {
    const message = getErrorMessage(error, "").toLowerCase()
    return (
        message.includes("unique") ||
        message.includes("duplicate") ||
        message.includes("already exists")
    )
}

function isContificoLogger(value: unknown): value is ContificoLogger {
    return !!value &&
        typeof value === "object" &&
        typeof (value as ContificoLogger).info === "function" &&
        typeof (value as ContificoLogger).warn === "function" &&
        typeof (value as ContificoLogger).error === "function"
}
