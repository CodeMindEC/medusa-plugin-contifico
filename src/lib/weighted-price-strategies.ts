export const WEIGHTED_PRICE_STRATEGY_VALUES = [
    "fixed_pvp_field",
    "rules_by_weight",
] as const

export type WeightedPriceStrategy =
    (typeof WEIGHTED_PRICE_STRATEGY_VALUES)[number]

export type StrategyWeightedPvpField = "pvp1" | "pvp2" | "pvp3" | "pvp4"

export interface WeightedPvpByGramsRule {
    grams: number
    field: StrategyWeightedPvpField
}

export interface FixedPvpFieldStrategyConfig {
    field: StrategyWeightedPvpField
}

export interface RulesByWeightStrategyConfig {
    fallback_field: StrategyWeightedPvpField
    rules: WeightedPvpByGramsRule[]
}

export interface WeightedPriceStrategyConfigMap {
    fixed_pvp_field: FixedPvpFieldStrategyConfig
    rules_by_weight: RulesByWeightStrategyConfig
}

export type WeightedPriceStrategyConfig =
    WeightedPriceStrategyConfigMap[WeightedPriceStrategy]

export interface WeightedPriceStrategyCapabilities {
    uses_fixed_field: boolean
    uses_weight_rules: boolean
    requires_contifico_price_data: boolean
    supports_price_lock: boolean
}

export interface WeightedStrategyNormalizationContext {
    fallback_field: StrategyWeightedPvpField
    legacy_rules?: WeightedPvpByGramsRule[] | null
}

export interface WeightedPriceFieldResolutionInput {
    grams: number | null | undefined
    fallback_field: StrategyWeightedPvpField
}

export interface WeightedPriceStrategyExplainResult {
    fallback_field: StrategyWeightedPvpField
    rules: WeightedPvpByGramsRule[]
    summary: string
}

export interface WeightedPriceStrategyDefinition<
    TStrategy extends WeightedPriceStrategy = WeightedPriceStrategy,
> {
    id: TStrategy
    label: string
    description: string
    capabilities: WeightedPriceStrategyCapabilities
    defaultConfig: (
        context: WeightedStrategyNormalizationContext
    ) => WeightedPriceStrategyConfigMap[TStrategy]
    normalizeConfig: (
        input: unknown,
        context: WeightedStrategyNormalizationContext
    ) => WeightedPriceStrategyConfigMap[TStrategy]
    validate: (config: WeightedPriceStrategyConfigMap[TStrategy]) => string[]
    resolvePriceField: (
        config: WeightedPriceStrategyConfigMap[TStrategy],
        input: WeightedPriceFieldResolutionInput
    ) => StrategyWeightedPvpField
    explain: (
        config: WeightedPriceStrategyConfigMap[TStrategy]
    ) => WeightedPriceStrategyExplainResult
}

export const WEIGHTED_PVP_FIELD_LITERALS = [
    "pvp1",
    "pvp2",
    "pvp3",
    "pvp4",
] as const

const FIXED_PVP_FIELD_STRATEGY: WeightedPriceStrategyDefinition<"fixed_pvp_field"> = {
    id: "fixed_pvp_field",
    label: "Campo fijo",
    description:
        "Usa un solo campo PVP para todas las variantes del producto base.",
    capabilities: {
        uses_fixed_field: true,
        uses_weight_rules: false,
        requires_contifico_price_data: true,
        supports_price_lock: true,
    },
    defaultConfig: ({ fallback_field }) => ({
        field: fallback_field,
    }),
    normalizeConfig: (input, context) => ({
        field: asWeightedPvpField(asRecord(input)?.field, context.fallback_field),
    }),
    validate: () => [],
    resolvePriceField: (config) => config.field,
    explain: (config) => ({
        fallback_field: config.field,
        rules: [],
        summary: `Campo fijo: ${config.field.toUpperCase()}`,
    }),
}

const RULES_BY_WEIGHT_STRATEGY: WeightedPriceStrategyDefinition<"rules_by_weight"> = {
    id: "rules_by_weight",
    label: "Reglas por peso",
    description:
        "Resuelve el campo PVP a partir del gramaje de cada variante y cae a un campo fallback cuando no hay match.",
    capabilities: {
        uses_fixed_field: true,
        uses_weight_rules: true,
        requires_contifico_price_data: true,
        supports_price_lock: true,
    },
    defaultConfig: ({ fallback_field, legacy_rules }) => ({
        fallback_field,
        rules: normalizeWeightedPvpRules(legacy_rules),
    }),
    normalizeConfig: (input, context) => {
        const record = asRecord(input)
        return {
            fallback_field: asWeightedPvpField(
                record?.fallback_field,
                context.fallback_field
            ),
            rules: normalizeWeightedPvpRules(
                Array.isArray(record?.rules)
                    ? (record.rules as WeightedPvpByGramsRule[])
                    : context.legacy_rules || []
            ),
        }
    },
    validate: (config) => {
        const warnings: string[] = []
        if (config.rules.length === 0) {
            warnings.push(
                "La estrategia rules_by_weight no tiene reglas; se usará siempre el campo fallback."
            )
        }
        return warnings
    },
    resolvePriceField: (config, input) =>
        config.rules.find((rule) => rule.grams === input.grams)?.field ||
        config.fallback_field,
    explain: (config) => ({
        fallback_field: config.fallback_field,
        rules: config.rules,
        summary:
            config.rules.length > 0
                ? `${config.rules.length} regla(s) por peso + fallback ${config.fallback_field.toUpperCase()}`
                : `Sin reglas; fallback ${config.fallback_field.toUpperCase()}`,
    }),
}

export const WEIGHTED_PRICE_STRATEGIES: Array<WeightedPriceStrategyDefinition> = [
    FIXED_PVP_FIELD_STRATEGY,
    RULES_BY_WEIGHT_STRATEGY,
]

export function isWeightedPriceStrategy(
    value: unknown
): value is WeightedPriceStrategy {
    return WEIGHTED_PRICE_STRATEGY_VALUES.includes(
        value as WeightedPriceStrategy
    )
}

export function isStrategyWeightedPvpField(
    value: unknown
): value is StrategyWeightedPvpField {
    return WEIGHTED_PVP_FIELD_LITERALS.includes(
        value as StrategyWeightedPvpField
    )
}

export function getWeightedPriceStrategyDefinition<
    TStrategy extends WeightedPriceStrategy,
>(strategy: TStrategy): WeightedPriceStrategyDefinition<TStrategy> {
    const definition = WEIGHTED_PRICE_STRATEGIES.find(
        (item) => item.id === strategy
    )

    if (!definition) {
        throw new Error(`Unsupported weighted pricing strategy: ${strategy}`)
    }

    return definition as WeightedPriceStrategyDefinition<TStrategy>
}

export function normalizeWeightedPriceStrategyConfig<
    TStrategy extends WeightedPriceStrategy,
>(
    strategy: TStrategy,
    input: unknown,
    context: WeightedStrategyNormalizationContext
): WeightedPriceStrategyConfigMap[TStrategy] {
    return getWeightedPriceStrategyDefinition(strategy).normalizeConfig(
        input,
        context
    )
}

export function getWeightedPriceStrategyDefaultConfig<
    TStrategy extends WeightedPriceStrategy,
>(
    strategy: TStrategy,
    context: WeightedStrategyNormalizationContext
): WeightedPriceStrategyConfigMap[TStrategy] {
    return getWeightedPriceStrategyDefinition(strategy).defaultConfig(context)
}

export function validateWeightedPriceStrategyConfig<
    TStrategy extends WeightedPriceStrategy,
>(
    strategy: TStrategy,
    config: WeightedPriceStrategyConfigMap[TStrategy]
): string[] {
    return getWeightedPriceStrategyDefinition(strategy).validate(config)
}

export function resolveWeightedPriceStrategyField<
    TStrategy extends WeightedPriceStrategy,
>(
    strategy: TStrategy,
    config: WeightedPriceStrategyConfigMap[TStrategy],
    input: WeightedPriceFieldResolutionInput
): StrategyWeightedPvpField {
    return getWeightedPriceStrategyDefinition(strategy).resolvePriceField(
        config,
        input
    )
}

export function explainWeightedPriceStrategy<
    TStrategy extends WeightedPriceStrategy,
>(
    strategy: TStrategy,
    config: WeightedPriceStrategyConfigMap[TStrategy]
): WeightedPriceStrategyExplainResult {
    return getWeightedPriceStrategyDefinition(strategy).explain(config)
}

function normalizeWeightedPvpRules(
    value: WeightedPvpByGramsRule[] | null | undefined
): WeightedPvpByGramsRule[] {
    const normalized = Array.isArray(value)
        ? value
              .map((rule) => ({
                  grams: asPositiveNumber(rule?.grams),
                  field: isStrategyWeightedPvpField(rule?.field)
                      ? rule.field
                      : null,
              }))
              .filter(
                  (
                      rule
                  ): rule is {
                      grams: number
                      field: StrategyWeightedPvpField
                  } => rule.grams != null && rule.field != null
              )
              .sort((a, b) => a.grams - b.grams)
        : []

    const deduped = new Map<number, StrategyWeightedPvpField>()
    for (const rule of normalized) {
        deduped.set(rule.grams, rule.field)
    }

    return Array.from(deduped.entries()).map(([grams, field]) => ({
        grams,
        field,
    }))
}

function asPositiveNumber(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return null
    }

    return value
}

function asWeightedPvpField(
    value: unknown,
    fallback: StrategyWeightedPvpField
): StrategyWeightedPvpField {
    return isStrategyWeightedPvpField(value) ? value : fallback
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}
