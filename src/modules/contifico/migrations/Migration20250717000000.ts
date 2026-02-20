import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20250717000000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                add column if not exists "manage_inventory" boolean not null default false,
                add column if not exists "allow_backorder" boolean not null default false;
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                drop column if exists "manage_inventory",
                drop column if exists "allow_backorder";
        `)
    }
}
