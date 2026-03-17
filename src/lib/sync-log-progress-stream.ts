import type { NdjsonStream } from "./ndjson"
import {
    updateSyncRunProgress,
    type ContificoSyncLogRecord,
} from "./contifico-sync-runs"
import type ContificoModuleService from "../modules/contifico/service"

export interface SyncLogStreamState<TData> {
    result?: TData
    error?: string
}

export function createSyncLogProgressStream<TData>(
    service: ContificoModuleService,
    log: Pick<ContificoSyncLogRecord, "id">,
    state: SyncLogStreamState<TData>
): NdjsonStream<TData> {
    return {
        progress: (phase, message, percent) => {
            void updateSyncRunProgress({
                service,
                log_id: log.id,
                phase,
                progress_percent: percent,
                details: {
                    progress_message: message,
                },
            })
        },
        result: (data) => {
            state.result = data
        },
        error: (message) => {
            state.error = message
        },
    }
}
