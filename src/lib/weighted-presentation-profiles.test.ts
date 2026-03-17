import { describe, expect, it } from "vitest"
import {
    normalizeWeightedPresentationProfiles,
    resolveWeightedPresentationProfile,
} from "./weighted-presentation-profiles"

describe("weighted presentation profiles", () => {
    it("normalizes profiles, variants and matcher values", () => {
        const profiles = normalizeWeightedPresentationProfiles([
            {
                id: " Retail Default ",
                name: " Retail Default ",
                matcher: {
                    category_ids: ["cat_1", "cat_1", " "],
                    code_prefixes: ["mdr", " MDR "],
                },
                variants: [
                    { grams: 250, pvp_field: "pvp2", sku_suffix: "250g" },
                    { grams: 100, pvp_field: "pvp1", label: "100 g" },
                    { grams: 100, pvp_field: "pvp3" },
                ],
            },
        ])

        expect(profiles).toEqual([
            {
                id: "retail-default",
                name: "Retail Default",
                matcher: {
                    category_ids: ["cat_1"],
                    code_prefixes: ["MDR"],
                },
                variants: [
                    { grams: 100, pvp_field: "pvp3", label: null, sku_suffix: null },
                    { grams: 250, pvp_field: "pvp2", label: null, sku_suffix: "250G" },
                ],
            },
        ])
    })

    it("resolves a profile by matcher rules", () => {
        const resolution = resolveWeightedPresentationProfile(
            {
                codigo: "MDR001DH",
                categoria_id: "cat_1",
                marca_id: "brand_1",
                unidad: "unit_1",
            },
            {
                creation_mode: "presentation_profile",
                creation_profiles: [
                    {
                        id: "retail",
                        name: "Retail",
                        matcher: {
                            category_ids: ["cat_1"],
                            code_prefixes: ["MDR"],
                        },
                        variants: [{ grams: 100, pvp_field: "pvp1" }],
                    },
                ],
            }
        )

        expect(resolution.profile?.id).toBe("retail")
        expect(resolution.decision.value).toBe("retail")
        expect(resolution.decision.reason).toContain("Perfil seleccionado")
    })

    it("falls back to the configured default profile", () => {
        const resolution = resolveWeightedPresentationProfile(
            {
                codigo: "BAN001",
                categoria_id: "cat_other",
                marca_id: null,
                unidad: null,
            },
            {
                creation_mode: "presentation_profile",
                default_profile_id: "default-profile",
                creation_profiles: [
                    {
                        id: "default-profile",
                        name: "Default",
                        variants: [{ grams: 100, pvp_field: "pvp1" }],
                    },
                ],
            }
        )

        expect(resolution.profile?.id).toBe("default-profile")
        expect(resolution.decision.reason).toContain("perfil por defecto")
    })

    it("blocks automatic creation when multiple profiles match", () => {
        const resolution = resolveWeightedPresentationProfile(
            {
                codigo: "MDR001",
                categoria_id: "cat_1",
                marca_id: "brand_1",
                unidad: "unit_1",
            },
            {
                creation_mode: "presentation_profile",
                creation_profiles: [
                    {
                        id: "profile-a",
                        name: "Profile A",
                        matcher: { category_ids: ["cat_1"] },
                        variants: [{ grams: 100, pvp_field: "pvp1" }],
                    },
                    {
                        id: "profile-b",
                        name: "Profile B",
                        matcher: { category_ids: ["cat_1"] },
                        variants: [{ grams: 250, pvp_field: "pvp2" }],
                    },
                ],
            }
        )

        expect(resolution.profile).toBeNull()
        expect(resolution.decision.reason).toContain("ambigüedad")
        expect(resolution.warnings).toHaveLength(2)
    })
})
