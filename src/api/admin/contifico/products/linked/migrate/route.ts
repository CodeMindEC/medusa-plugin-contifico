import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runMigrateLinkedProductMetadata } from "../../../../../../lib/use-cases/admin-support"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    return runMigrateLinkedProductMetadata(req, res)
}
