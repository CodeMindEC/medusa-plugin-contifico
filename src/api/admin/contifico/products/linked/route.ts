import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runListLinkedProducts } from "../../../../../lib/use-cases/linked-products"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    return runListLinkedProducts(req, res)
}
