import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runDeleteImportedProducts } from "../../../../../../lib/use-cases/delete-imported-products"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    return runDeleteImportedProducts(req, res)
}
