import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runCheckContificoConnection } from "../../../../../lib/use-cases/admin-support"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    return runCheckContificoConnection(req, res)
}
