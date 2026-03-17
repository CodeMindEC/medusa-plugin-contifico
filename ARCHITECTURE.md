# Architecture

## Core v2

El plugin opera sobre un contrato canónico `advanced_settings.version = 2`.

Objetivos del core v2:

- una sola fuente de verdad para configuración runtime,
- migración automática y persistente desde configs legacy,
- estrategias weighted registrables,
- UI guiada por capacidades en lugar de `if` ad hoc,
- metadata de vínculos normalizada y tipada.

## Config lifecycle

`ContificoConfigRecord` sigue almacenando columnas legacy como `variant_mode` y `weighted_pvp_field`, pero el runtime consume `NormalizedContificoConfig`.

Flujo:

1. se lee la config cruda desde DB,
2. `normalizeContificoConfig` convierte el payload a runtime v2,
3. `getContificoConfigMigrationPatch` detecta divergencias persistibles,
4. `getContificoConfig` persiste la migración una vez y devuelve la config ya convergida.

Esto evita tener compat layers permanentes en el resto del plugin.

## Weighted strategies

El patrón público de extensión vive en `src/lib/weighted-price-strategies.ts`.

Cada estrategia declara:

- `id`
- `label`
- `description`
- `capabilities`
- `defaultConfig`
- `normalizeConfig`
- `validate`
- `resolvePriceField`
- `explain`

Estrategias built-in:

- `fixed_pvp_field`
- `rules_by_weight`

La lógica real del cliente actual vive dentro de `rules_by_weight`; no hay hacks específicos por `100g/250g/500g` en el core ni en la UI.

## Weighted runtime

Los consumidores runtime relevantes usan el mismo resolver:

- sync weighted de productos,
- armado de factura,
- preview de factura,
- diagnóstico de productos vinculados.

La resolución sigue este orden:

1. override explícito por producto (`metadata.weighted_pvp_field`),
2. estrategia weighted efectiva,
3. fallback field de la estrategia.

## Invoice use cases

La orquestación de facturas ya no está repartida entre rutas y subscribers.

Casos de uso principales:

- `createOrderInvoiceDocument`
- `createStandaloneTestInvoiceDocument`
- `deleteTestInvoiceDocuments`

Beneficios:

- lógica única de idempotencia,
- carga de orden unificada,
- persistencia de metadata consistente,
- logging homogéneo,
- misma ruta para manual y automático.

Para documentos asociados a una orden, el `entity_map.medusa_id` nuevo usa una clave typed:

- `order_id:PRE`
- `order_id:FAC`
- `test:order_id:PRE`
- `test:order_id:FAC`

Eso endurece idempotencia para `PRE` y `FAC` sin volver a bloquear ambos documentos entre sí.

## Product metadata

La metadata de `entity_map` de producto se normaliza en `src/lib/contifico-metadata.ts`.

Reglas:

- `schema_version = 2` al persistir metadata v2,
- `product_rules_override` se limpia y normaliza al shape canónico,
- `link_origin` se resuelve de forma determinista,
- la metadata legacy converge a v2 al leerse/escribirse.

## UI dependency matrix

La capa declarativa está en `src/lib/config-gates.ts`.

Cada gate declara:

- `visibleWhen`
- `enabledWhen`
- `disabledReason`

La UI admin usa esta matriz para evitar combinaciones inválidas. Ejemplos actuales:

- controles weighted solo visibles en modo weighted,
- lock de precio weighted solo habilitado con sync de productos y estrategia compatible,
- reglas por peso visibles solo si la estrategia las usa,
- facturación automática bloqueada sin `api_pos`,
- intervalo de sync bloqueado si no hay ninguna tarea automática activa.

## Observability

La base de observabilidad vive en `src/lib/observability.ts`.

Convenciones actuales:

- cada operación relevante genera `correlation_id`,
- logs estructurados para sync e invoicing,
- `sync_logs.details` preserva `correlation_id` y trigger cuando aplica,
- la deduplicación de facturas remotas se registra explícitamente.

Las rutas auxiliares de admin también convergieron al mismo patrón mediante casos de uso:

- carga de bodegas,
- check de conexión,
- migración de metadata de productos vinculados.

## Testing strategy

La suite base usa Vitest y cubre:

- migración legacy -> v2,
- registry weighted,
- fallback behavior,
- normalización de config,
- dependency gates,
- sync principal de productos,
- subscribers automáticos `PRE/FAC`,
- soporte admin (`bodegas`, `check-connection`, `linked migrate`).

Cobertura futura recomendada:

- preview e invoice payloads con fixtures,
- tests de rutas admin con request/response reales.

## How to add a new weighted strategy

1. agregar la estrategia al registry en `src/lib/weighted-price-strategies.ts`,
2. definir `capabilities`, `normalizeConfig`, `resolvePriceField` y `explain`,
3. verificar si la estrategia necesita nuevos controles UI,
4. extender `config-gates.ts` si introduce nuevas dependencias,
5. agregar tests de resolución, normalización y explanation,
6. exponer la decisión efectiva en preview/diagnostics si afecta runtime.
