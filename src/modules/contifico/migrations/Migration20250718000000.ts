import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20250718000000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                add column if not exists "invoice_test_mode" boolean not null default false;
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                drop column if exists "invoice_test_mode";
        `)
    }
}
