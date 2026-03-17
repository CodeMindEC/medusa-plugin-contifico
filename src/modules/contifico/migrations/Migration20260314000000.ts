import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260314000000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                add column if not exists "advanced_settings" text null;
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                drop column if exists "advanced_settings";
        `)
    }
}
