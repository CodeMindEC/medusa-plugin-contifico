import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runFetchContificoBodegas } from "../../../../../lib/use-cases/admin-support"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    return runFetchContificoBodegas(req, res)
}
