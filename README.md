# Contifico Plugin

Plugin de Medusa v2 para integrar Contífico con catálogo, clientes, stock y facturación.

## Estado actual

El plugin opera sobre un core `v2` más limpio:

- `advanced_settings.version = 2` como contrato canónico,
- migración automática y persistente desde configuraciones legacy,
- estrategias weighted registrables,
- UI administrada por capacidades y dependency gates,
- metadata de vínculos normalizada a schema v2.

La lógica del cliente actual se preserva como estrategia built-in OSS, no como excepción privada.

## Funcionalidades

- sincronización de productos y stock,
- sincronización de clientes,
- matching automático, vínculo manual y re-link,
- mapeo weighted para producto base por peso,
- creación de `PRE` y `FAC`,
- previews de sync, borrado e invoice payload,
- logs y diagnósticos administrativos.

## Weighted pricing

El modo weighted ya no depende de flags sueltos.

Estrategias built-in:

- `fixed_pvp_field`
- `rules_by_weight`

Cada estrategia declara su config, capacidades, resolución de PVP y explicación diagnóstica. Eso permite:

- preservar el caso real de gramajes por variante,
- generalizarlo para instalaciones OSS,
- evitar texto o defaults acoplados a un solo cliente.

## Operación e idempotencia

La creación de documentos por orden usa casos de uso unificados y claves typed por orden/tipo para endurecer `PRE` y `FAC`.

También se agregaron:

- `correlation_id` para sync e invoicing,
- deduplicación local más fuerte para documentos automáticos,
- cancelación defensiva del documento remoto si gana una carrera de duplicado local.

## Desarrollo

Requisitos:

- Node `>= 20`
- `pnpm`
- Medusa `2.13.3`

Scripts principales:

```bash
pnpm --filter contifico-plugin build
pnpm --filter contifico-plugin test
pnpm --filter contifico-plugin dev
```

CI:

- workflow dedicado en `.github/workflows/contifico-plugin.yml`,
- valida `build` y `test` del paquete cuando cambian archivos del plugin.

## Documentación técnica

- [ARCHITECTURE.md](./ARCHITECTURE.md)

## Qué probar antes de release

- build del plugin,
- suite Vitest,
- preview weighted con mezcla de presentaciones,
- sync weighted con bloqueo global y override por producto,
- creación de `PRE` y `FAC` con misma orden,
- migración automática de una config legacy real.
