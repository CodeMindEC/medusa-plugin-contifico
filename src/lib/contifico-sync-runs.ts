import type ContificoModuleService from "../modules/contifico/service"
import { createCorrelationId } from "./observability"

export const CONTIFICO_SYNC_STATUSES = [
    "queued",
    "running",
    "success",
    "partial",
    "error",
    "cancelled",
] as const

export type ContificoSyncStatus = (typeof CONTIFICO_SYNC_STATUSES)[number]
export type ContificoSyncType = "products" | "products-stock" | "products-delete"

export interface ContificoSyncLogRecord {
    id: string
    sync_type: string
    status: string
    created?: boolean
    phase?: string | null
    progress_percent?: number
    finished_at?: string | null
    parent_log_id?: string | null
    total_processed?: number
    total_errors?: number
    duration_ms?: number
    started_at?: string
    details?: Record<string, unknown> | null
}

interface EnsureSyncRunInput {
    service: ContificoModuleService
    sync_type: ContificoSyncType
    config_id?: string | null
    parent_log_id?: string | null
    requested_by?: string | null
    initial_details?: Record<string, unknown> | null
}

interface UpdateSyncRunProgressInput {
    service: ContificoModuleService
    log_id: string
    phase: string
    progress_percent: number
    details?: Record<string, unknown> | null
}

interface CompleteSyncRunInput {
    service: ContificoModuleService
    log_id: string
    status: Extract<ContificoSyncStatus, "success" | "partial" | "error" | "cancelled">
    total_processed?: number
    total_errors?: number
    details?: Record<string, unknown> | null
}

export async function ensureQueuedSyncRun({
    service,
    sync_type,
    config_id,
    parent_log_id,
    requested_by,
    initial_details,
}: EnsureSyncRunInput): Promise<ContificoSyncLogRecord> {
    const existing = await findActiveSyncRun(service, sync_type, config_id)
    if (existing) {
        return existing
    }

    const started_at = new Date().toISOString()
    const correlation_id = createCorrelationId(`contifico_${sync_type.replace(/[^a-z]/g, "_")}`)
    const created = await service.createContificoSyncLogs({
        sync_type,
        status: "queued",
        phase: "queued",
        progress_percent: 0,
        finished_at: null,
        parent_log_id: parent_log_id || null,
        total_processed: 0,
        total_errors: 0,
        duration_ms: 0,
        started_at,
        details: {
            correlation_id,
            config_id: config_id || null,
            requested_by: requested_by || "manual",
            ...(initial_details || {}),
        },
    })

    return {
        ...normalizeSyncLogRecord(created),
        created: true,
    }
}

export async function findActiveSyncRun(
    service: ContificoModuleService,
    sync_type: ContificoSyncType,
    config_id?: string | null
): Promise<ContificoSyncLogRecord | null> {
    const [logs] = await service.listAndCountContificoSyncLogs(
        {
            sync_type,
            status: ["queued", "running"],
        },
        {
            order: { created_at: "DESC" },
            take: 20,
        }
    )

    const normalizedLogs = logs
        .map(normalizeSyncLogRecord)
        .filter((log) =>
            config_id
                ? readLogConfigId(log.details) === config_id
                : true
        )

    return normalizedLogs[0] || null
}

export async function markSyncRunRunning(
    service: ContificoModuleService,
    log_id: string,
    details?: Record<string, unknown> | null
) {
    return updateSyncRun(service, log_id, {
        status: "running",
        phase: "init",
        progress_percent: 1,
        details,
    })
}

export async function updateSyncRunProgress({
    service,
    log_id,
    phase,
    progress_percent,
    details,
}: UpdateSyncRunProgressInput) {
    return updateSyncRun(service, log_id, {
        phase,
        progress_percent: clampProgress(progress_percent),
        details,
    })
}

export async function completeSyncRun({
    service,
    log_id,
    status,
    total_processed,
    total_errors,
    details,
}: CompleteSyncRunInput) {
    const current = await getSyncRun(service, log_id)
    const startedAt = current?.started_at
        ? Date.parse(current.started_at)
        : Date.now()
    const finishedAtIso = new Date().toISOString()

    return updateSyncRun(service, log_id, {
        status,
        phase: "done",
        progress_percent: 100,
        finished_at: finishedAtIso,
        total_processed: total_processed ?? current?.total_processed ?? 0,
        total_errors: total_errors ?? current?.total_errors ?? 0,
        duration_ms: Math.max(0, Date.now() - startedAt),
        details,
    })
}

export async function failSyncRun(
    service: ContificoModuleService,
    log_id: string,
    error: string,
    details?: Record<string, unknown> | null
) {
    const current = await getSyncRun(service, log_id)
    return completeSyncRun({
        service,
        log_id,
        status: "error",
        total_processed: current?.total_processed ?? 0,
        total_errors: (current?.total_errors ?? 0) + 1,
        details: {
            fatal: error,
            ...(details || {}),
        },
    })
}

export async function getSyncRun(
    service: ContificoModuleService,
    id: string
): Promise<ContificoSyncLogRecord | null> {
    const [logs] = await service.listAndCountContificoSyncLogs({ id }, { take: 1 })
    return logs[0] ? normalizeSyncLogRecord(logs[0]) : null
}

export function readLogCorrelationId(details: unknown): string | null {
    if (!isRecord(details)) {
        return null
    }

    return typeof details.correlation_id === "string" ? details.correlation_id : null
}

export function readLogConfigId(details: unknown): string | null {
    if (!isRecord(details)) {
        return null
    }

    return typeof details.config_id === "string" ? details.config_id : null
}

export async function updateSyncRun(
    service: ContificoModuleService,
    log_id: string,
    patch: Partial<ContificoSyncLogRecord>
) {
    const current = await getSyncRun(service, log_id)
    const nextDetails = mergeDetails(current?.details, patch.details)

    return service.updateContificoSyncLogs({
        id: log_id,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
        ...(patch.progress_percent !== undefined
            ? { progress_percent: clampProgress(patch.progress_percent) }
            : {}),
        ...(patch.finished_at !== undefined ? { finished_at: patch.finished_at } : {}),
        ...(patch.parent_log_id !== undefined ? { parent_log_id: patch.parent_log_id } : {}),
        ...(typeof patch.total_processed === "number"
            ? { total_processed: patch.total_processed }
            : {}),
        ...(typeof patch.total_errors === "number"
            ? { total_errors: patch.total_errors }
            : {}),
        ...(typeof patch.duration_ms === "number"
            ? { duration_ms: patch.duration_ms }
            : {}),
        ...(typeof patch.started_at === "string" ? { started_at: patch.started_at } : {}),
        ...(nextDetails ? { details: nextDetails } : {}),
    })
}

export function normalizeSyncLogRecord(value: unknown): ContificoSyncLogRecord {
    if (!isRecord(value)) {
        return {
            id: "",
            sync_type: "",
            status: "error",
        }
    }

    return {
        id: typeof value.id === "string" ? value.id : "",
        sync_type: typeof value.sync_type === "string" ? value.sync_type : "",
        status: typeof value.status === "string" ? value.status : "error",
        phase: typeof value.phase === "string" ? value.phase : null,
        progress_percent:
            typeof value.progress_percent === "number" ? value.progress_percent : 0,
        finished_at: typeof value.finished_at === "string" ? value.finished_at : null,
        parent_log_id:
            typeof value.parent_log_id === "string" ? value.parent_log_id : null,
        total_processed:
            typeof value.total_processed === "number" ? value.total_processed : 0,
        total_errors: typeof value.total_errors === "number" ? value.total_errors : 0,
        duration_ms: typeof value.duration_ms === "number" ? value.duration_ms : 0,
        started_at: typeof value.started_at === "string" ? value.started_at : undefined,
        details: isRecord(value.details) ? value.details : null,
    }
}

function mergeDetails(
    current: Record<string, unknown> | null | undefined,
    patch: Record<string, unknown> | null | undefined
) {
    if (!current && !patch) {
        return undefined
    }

    return {
        ...(current || {}),
        ...(patch || {}),
    }
}

function clampProgress(value: number) {
    if (!Number.isFinite(value)) {
        return 0
    }

    return Math.max(0, Math.min(100, Math.round(value)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}
