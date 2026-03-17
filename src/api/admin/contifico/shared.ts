import { CONTIFICO_MODULE } from "../../../modules/contifico"
import type ContificoModuleService from "../../../modules/contifico/service"
import {
    getContificoConfigMigrationPatch,
    normalizeContificoConfig,
    type ContificoConfigRecord,
    type NormalizedContificoConfig,
} from "../../../lib/contifico-config"
import { bindContificoLogger } from "../../../lib/observability"
export { getErrorMessage } from "../../../lib/observability"

interface ContificoConfigResult {
    raw: ContificoConfigRecord | null
    normalized: NormalizedContificoConfig | null
}

/**
 * Load config without applying migration patches (pure read).
 */
export async function loadContificoConfig(
    service: ContificoModuleService
): Promise<ContificoConfigResult> {
    const [configs] = await service.listAndCountContificoConfigs()
    const raw = (configs[0] as ContificoConfigRecord | undefined) || null

    return {
        raw,
        normalized: raw ? normalizeContificoConfig(raw) : null,
    }
}

/**
 * Apply migration patches to config if needed.
 * Call this explicitly when saving config (POST /config).
 */
export async function migrateContificoConfigIfNeeded(
    service: ContificoModuleService,
    raw: ContificoConfigRecord
): Promise<ContificoConfigRecord> {
    const migrationPatch = getContificoConfigMigrationPatch(raw)
    if (!migrationPatch) {
        return raw
    }

    return (await service.updateContificoConfigs({
        id: raw.id,
        ...migrationPatch,
    })) as ContificoConfigRecord
}

/**
 * Load config and auto-apply migration patches.
 * @deprecated Prefer `loadContificoConfig` + explicit `migrateContificoConfigIfNeeded`.
 */
export async function getContificoConfig(
    service: ContificoModuleService
): Promise<ContificoConfigResult> {
    const [configs] = await service.listAndCountContificoConfigs()
    const initialRaw = (configs[0] as ContificoConfigRecord | undefined) || null

    if (!initialRaw) {
        return {
            raw: null,
            normalized: null,
        }
    }

    const migrationPatch = getContificoConfigMigrationPatch(initialRaw)
    const raw = migrationPatch
        ? ((await service.updateContificoConfigs({
            id: initialRaw.id,
            ...migrationPatch,
        })) as ContificoConfigRecord)
        : initialRaw

    return {
        raw,
        normalized: normalizeContificoConfig(raw),
    }
}

export function getContificoService(scope: {
    resolve: (key: string) => unknown
}): ContificoModuleService {
    bindContificoLogger(scope)
    return scope.resolve(CONTIFICO_MODULE) as ContificoModuleService
}
