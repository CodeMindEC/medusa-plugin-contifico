import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    asProductMapMetadata,
    resolveProductLinkOrigin,
} from "../../../../../../../lib/contifico-metadata"
import {
    buildDeletePreviewResult,
    resolveLinkedProductCleanup,
} from "../../../../../../../lib/strategies/delete-policy"
import { getContificoConfig, getContificoService } from "../../../../shared"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    try {
        const service = getContificoService(req.scope)
        const { normalized: config } = await getContificoConfig(service)

        if (!config) {
            res.status(400).json(
                buildDeletePreviewResult({}, [], ["No hay configuración de Contífico."])
            )
            return
        }

        const [maps] = await service.listAndCountContificoEntityMaps(
            { entity_type: "product" },
            { take: 5000 }
        )

        const decisions = maps.map((map) => {
            const metadata = asProductMapMetadata(map.metadata)
            const linkOrigin = resolveProductLinkOrigin(metadata)

            return resolveLinkedProductCleanup(
                linkOrigin,
                config.advanced_settings.delete_policy,
                metadata.sync_snapshot
            ).decision
        })

        const cleanupPlans = maps.map((map) => {
            const metadata = asProductMapMetadata(map.metadata)
            const linkOrigin = resolveProductLinkOrigin(metadata)

            return resolveLinkedProductCleanup(
                linkOrigin,
                config.advanced_settings.delete_policy,
                metadata.sync_snapshot
            )
        })
        const deleteCount = cleanupPlans.filter((plan) => plan.action === "delete_product").length
        const unlinkCount = cleanupPlans.filter((plan) => plan.action === "unlink_only").length
        const restoreCount = cleanupPlans.filter((plan) => plan.restore_prices).length
        const unlinkWithoutSnapshot = unlinkCount - restoreCount
        const warnings =
            unlinkWithoutSnapshot > 0
                ? [
                      `${unlinkWithoutSnapshot} producto(s) se desvincularán sin restauración exacta de precio porque no existe snapshot previo.`,
                  ]
                : []

        res.json(
            buildDeletePreviewResult(
                {
                    total_linked: maps.length,
                    products_to_delete: deleteCount,
                    products_to_unlink: unlinkCount,
                    products_with_price_restore: restoreCount,
                    products_without_price_snapshot: unlinkWithoutSnapshot,
                    require_preview: config.advanced_settings.delete_policy.require_preview,
                },
                decisions,
                [],
                warnings
            )
        )
    } catch (error) {
        res.status(500).json(
            buildDeletePreviewResult(
                {},
                [],
                [error instanceof Error ? error.message : "Error generando preview"]
            )
        )
    }
}
