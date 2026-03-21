# @codemind.ec/medusa-plugin-contifico

Medusa v2 plugin for **Contífico ERP** integration — product & stock sync, customer mapping, weighted pricing strategies, and automated electronic invoicing for Ecuador.

[![npm version](https://img.shields.io/npm/v/@codemind.ec/medusa-plugin-contifico.svg)](https://www.npmjs.com/package/@codemind.ec/medusa-plugin-contifico)
[![Medusa v2](https://img.shields.io/badge/medusa-v2-blueviolet)](https://docs.medusajs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

- **Product synchronization** — import products and categories from Contífico, with automatic variant creation.
- **Stock synchronization** — real-time inventory levels from Contífico warehouses (`bodegas`).
- **Customer mapping** — match and sync customers between Medusa and Contífico.
- **Weighted pricing** — pluggable strategies for weight-based product pricing (e.g., products sold by weight in grams/kg).
- **Electronic invoicing** — automatic creation of pre-invoices (`PRE`) on order placement and invoices (`FAC`) on payment capture.
- **Admin UI** — full dashboard for configuration, diagnostics, sync triggers, invoice previews, and linked product management.
- **Observability** — correlation IDs, structured logs, and sync audit trail.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js     | >= 20   |
| Medusa      | >= 2.4.0 |
| Contífico account | API key required |

---

## Installation

```bash
npm install @codemind.ec/medusa-plugin-contifico
# or
pnpm add @codemind.ec/medusa-plugin-contifico
```

---

## Configuration

Add the plugin to your `medusa-config.ts`:

```typescript
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  // ...
  plugins: [
    {
      resolve: "@codemind.ec/medusa-plugin-contifico",
      options: {},
    },
  ],
})
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONTIFICO_API_KEY` | Yes | Contífico API key |
| `CONTIFICO_API_POS` | For invoicing | Point-of-sale identifier for `FAC` / `PRE` |
| `CONTIFICO_URL` | No | API base URL (default: `https://api.contifico.com`) |

---

## Architecture

### Module: `contifico`

The plugin registers a single module with three database models:

#### `contifico_config` — Master configuration

| Field | Type | Description |
|-------|------|-------------|
| `api_key` | string | Contífico API key |
| `api_pos` | string | Point-of-sale ID |
| `bodega_ids` | string | Comma-separated warehouse IDs |
| `sync_products_enabled` | boolean | Enable product sync |
| `sync_customers_enabled` | boolean | Enable customer sync |
| `auto_invoice_enabled` | boolean | Auto-create `FAC` on payment capture |
| `auto_preinvoice_enabled` | boolean | Auto-create `PRE` on order placed |
| `sync_interval_minutes` | number | Sync frequency (default: 60) |
| `variant_mode` | enum | `"auto"` \| `"contifico"` \| `"simple"` \| `"weighted"` |
| `weighted_pvp_field` | enum | `"pvp1"` \| `"pvp2"` \| `"pvp3"` \| `"pvp4"` |
| `advanced_settings` | JSON | Versioned configuration (v2) |
| `import_filters` | JSON | Product import filters |
| `invoice_test_mode` | boolean | Test mode for invoicing |

#### `contifico_entity_map` — Medusa ↔ Contífico ID mapping

| Field | Type | Description |
|-------|------|-------------|
| `entity_type` | enum | `product` \| `variant` \| `customer` \| `category` \| `invoice` |
| `medusa_id` | string | Medusa entity ID (or typed key like `order_id:FAC`) |
| `contifico_id` | string | Contífico entity ID |
| `metadata` | JSON? | Extra mapping data |

#### `contifico_sync_log` — Audit trail

| Field | Type | Description |
|-------|------|-------------|
| `sync_type` | enum | `products` \| `stock` \| `customers` \| `invoice` |
| `status` | enum | `queued` \| `running` \| `success` \| `partial` \| `error` \| `cancelled` |
| `phase` | string? | Current phase description |
| `progress_percent` | number? | Progress 0–100 |
| `duration_ms` | number? | Total duration |
| `total_processed` | number? | Items processed |
| `total_errors` | number? | Error count |
| `details` | JSON? | Detailed results |
| `correlation_id` | string? | Correlation ID for tracing |

---

### HTTP Client

The plugin includes a purpose-built HTTP client with:

- **Automatic retry** with exponential backoff
- **Request timeout** (15s default)
- **SSRF protection** — blocks private IP ranges

Sub-clients:

| Client | Scope |
|--------|-------|
| `ContificoProductsClient` | Product & category CRUD |
| `ContificoInvoicesClient` | Create, query, cancel documents |
| `ContificoCustomersClient` | Search & create customers |
| `ContificoInventoryClient` | Stock lookups |

---

### Weighted Pricing Strategies

The plugin supports pluggable pricing strategies for weight-based products:

#### Built-in strategies

| Strategy | Description |
|----------|-------------|
| `fixed_pvp_field` | Uses a fixed PVP field (`pvp1`–`pvp4`) for all products |
| `rules_by_weight` | Calculates PVP based on weight range rules (e.g., 100–250g, 250–500g) |

**Price resolution precedence:**

1. Per-product override (`product.metadata.weighted_pvp_field`)
2. Active weighted strategy
3. Fallback field from strategy defaults

#### Custom strategies

Strategies implement the `WeightedPriceStrategy` interface:

```typescript
interface WeightedPriceStrategy {
  id: string
  label: string
  description: string
  capabilities: {
    uses_fixed_field?: boolean
    uses_weight_rules?: boolean
    supports_price_lock?: boolean
  }
  defaultConfig: object
  normalizeConfig(config: unknown): object
  validate(config: unknown): ValidationResult
  resolvePriceField(product: any, context: any): string | number
  explain(product: any, context: any): string
}
```

---

### Config Gates (UI Dependency Matrix)

The admin UI uses declarative dependency gates to show/hide/disable fields based on configuration state:

| Gate | Visible When | Enabled When |
|------|-------------|--------------|
| `weighted_strategy` | `variant_mode === "weighted"` | always |
| `weighted_price_lock` | sync_products enabled | strategy `supports_price_lock` |
| `auto_invoice` | always | `api_pos` configured |
| `sync_interval` | always | ≥ 1 automatic task active |

---

## API Reference

### Admin Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/contifico/config` | Get current configuration |
| `POST` | `/admin/contifico/config` | Update configuration |
| `GET` | `/admin/contifico/bodegas` | List warehouses from Contífico |
| `GET` | `/admin/contifico/status` | Health check + last sync timestamps |
| `POST` | `/admin/contifico/sync/products` | Trigger manual product sync |
| `POST` | `/admin/contifico/invoices/test` | Preview invoice payload |
| `GET` | `/admin/contifico/linked-products` | List linked products for diagnostics |

---

## Subscribers (Automation)

| Event | Action |
|-------|--------|
| `CONTIFICO_PRODUCTS_SYNC_REQUESTED` | Runs product sync job |
| `CONTIFICO_PRODUCTS_STOCK_REQUESTED` | Runs stock sync job |
| `order.placed` | Creates `PRE` (if `auto_preinvoice_enabled`) |
| `payment.captured` | Creates `FAC` (if `auto_invoice_enabled` + `api_pos`) |

All automated operations use `correlation_id` for end-to-end tracing.

---

## Invoicing

### Idempotency

Documents use typed keys (`order_id:PRE`, `order_id:FAC`) to prevent duplicates. The system performs:

1. **Local deduplication** — checks `contifico_entity_map` before creating.
2. **Remote deduplication** — queries Contífico API for existing documents.
3. **Race condition handling** — if a remote duplicate is detected after creation, the local duplicate is cancelled defensively.

### Test Mode

When `invoice_test_mode` is enabled, documents are created with prefix `test:order_id:TYPE` and can be bulk-deleted via `deleteTestInvoiceDocuments()`.

---

## Testing

```bash
pnpm test
```

The plugin includes a Vitest suite covering:

- Legacy → v2 config migration
- Weighted strategy registry
- Dependency gate evaluation
- Product sync pipeline
- PRE/FAC subscriber flows

---

## License

MIT — [CodeMind](https://codemind.ec)
