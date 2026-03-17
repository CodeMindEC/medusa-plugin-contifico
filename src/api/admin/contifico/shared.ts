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

export async function getContificoConfig(
    service: ContificoModuleService
): Promise<{
    raw: ContificoConfigRecord | null
    normalized: NormalizedContificoConfig | null
}> {
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
