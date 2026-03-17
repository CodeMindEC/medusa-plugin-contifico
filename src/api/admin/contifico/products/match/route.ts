import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runProductMatch } from "../../../../../lib/use-cases/product-match"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    return runProductMatch(req, res)
}
