import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runCustomerSync } from "../../../../../lib/use-cases/customer-sync"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    return runCustomerSync(req, res)
}
