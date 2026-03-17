import { describe, expect, it } from "vitest"
import { resolveVariantPriceAmount } from "./product-create-builders"

describe("product create builders", () => {
    it("keeps the raw PVP amount for non-weighted variants", () => {
        expect(
            resolveVariantPriceAmount(
                {
                    pvp1: "5.55",
                    pvp2: "13.95",
                    pvp3: "27.95",
                    pvp4: null,
                },
                "pvp1"
            )
        ).toBe(5.55)
    })

    it("calculates the total weighted price from grams and per-gram PVP", () => {
        expect(
            resolveVariantPriceAmount(
                {
                    pvp1: "0.0555",
                    pvp2: "0.0558",
                    pvp3: "0.0559",
                    pvp4: null,
                },
                "pvp2",
                250
            )
        ).toBe(13.95)
    })
})
