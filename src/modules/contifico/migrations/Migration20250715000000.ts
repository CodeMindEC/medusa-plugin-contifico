import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20250715000000 extends Migration {
    async up(): Promise<void> {
        // contifico_config
        this.addSql(
            `create table if not exists "contifico_config" (
        "id" text not null,
        "api_key" text not null default '',
        "api_pos" text null,
        "bodega_id" text null,
        "sync_products_enabled" boolean not null default false,
        "sync_customers_enabled" boolean not null default false,
        "auto_invoice_enabled" boolean not null default false,
        "auto_preinvoice_enabled" boolean not null default false,
        "sync_interval_minutes" integer not null default 60,
        "last_product_sync" text null,
        "last_customer_sync" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "contifico_config_pkey" primary key ("id")
      );`
        )
        this.addSql(
            'create index if not exists "IDX_contifico_config_deleted_at" on "contifico_config" ("deleted_at");'
        )

        // contifico_entity_map
        this.addSql(
            `create table if not exists "contifico_entity_map" (
        "id" text not null,
        "entity_type" text not null,
        "medusa_id" text not null,
        "contifico_id" text not null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "contifico_entity_map_pkey" primary key ("id")
      );`
        )
        this.addSql(
            'create unique index if not exists "IDX_contifico_entity_map_type_medusa" on "contifico_entity_map" ("entity_type", "medusa_id") where deleted_at is null;'
        )
        this.addSql(
            'create index if not exists "IDX_contifico_entity_map_type_contifico" on "contifico_entity_map" ("entity_type", "contifico_id") where deleted_at is null;'
        )
        this.addSql(
            'create index if not exists "IDX_contifico_entity_map_deleted_at" on "contifico_entity_map" ("deleted_at");'
        )

        // contifico_sync_log
        this.addSql(
            `create table if not exists "contifico_sync_log" (
        "id" text not null,
        "sync_type" text not null,
        "status" text not null,
        "total_processed" integer not null default 0,
        "total_errors" integer not null default 0,
        "details" jsonb null,
        "duration_ms" integer not null default 0,
        "started_at" text not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "contifico_sync_log_pkey" primary key ("id")
      );`
        )
        this.addSql(
            'create index if not exists "IDX_contifico_sync_log_deleted_at" on "contifico_sync_log" ("deleted_at");'
        )
    }

    async down(): Promise<void> {
        this.addSql('drop table if exists "contifico_sync_log";')
        this.addSql('drop table if exists "contifico_entity_map";')
        this.addSql('drop table if exists "contifico_config";')
    }
}
