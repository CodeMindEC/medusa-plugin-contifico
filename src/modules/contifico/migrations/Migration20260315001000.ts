import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260315001000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            alter table if exists "contifico_sync_log"
            add column if not exists "phase" text null,
            add column if not exists "progress_percent" integer not null default 0,
            add column if not exists "finished_at" text null,
            add column if not exists "parent_log_id" text null;
        `)

        this.addSql(`
            create index if not exists "IDX_contifico_sync_log_status_type"
            on "contifico_sync_log" ("status", "sync_type")
            where deleted_at is null;
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            drop index if exists "IDX_contifico_sync_log_status_type";
        `)

        this.addSql(`
            alter table if exists "contifico_sync_log"
            drop column if exists "phase",
            drop column if exists "progress_percent",
            drop column if exists "finished_at",
            drop column if exists "parent_log_id";
        `)
    }
}
