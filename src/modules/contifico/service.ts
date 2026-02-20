import { MedusaService } from "@medusajs/framework/utils"
import { ContificoConfig, ContificoEntityMap, ContificoSyncLog } from "./models"

class ContificoModuleService extends MedusaService({
    ContificoConfig,
    ContificoEntityMap,
    ContificoSyncLog,
}) { }

export default ContificoModuleService
