import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    runCreateProductLinks,
    runDeleteProductLink,
    runRelinkProductLink,
} from "../../../../../lib/use-cases/product-links"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    return runCreateProductLinks(req, res)
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
    return runDeleteProductLink(req, res)
}

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
    return runRelinkProductLink(req, res)
}
