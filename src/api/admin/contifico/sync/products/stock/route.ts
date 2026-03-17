import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runProductStockSync } from "../../../../../../lib/use-cases/product-sync"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    return runProductStockSync(req, res)
}
