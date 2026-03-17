import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runProductSync } from "../../../../../lib/use-cases/product-sync"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    return runProductSync(req, res)
}
