import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20250717200000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                add column if not exists "variant_mode" text not null default 'auto';
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                drop column if exists "variant_mode";
        `)
    }
}
