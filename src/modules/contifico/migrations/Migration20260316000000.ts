import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260316000000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            alter table if exists "contifico_config"
            add column if not exists "auto_preinvoice_enabled" boolean not null default false;
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            alter table if exists "contifico_config"
            drop column if exists "auto_preinvoice_enabled";
        `)
    }
}
