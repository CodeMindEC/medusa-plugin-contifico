import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20250717100000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                add column if not exists "sales_channel_id" text null,
                add column if not exists "shipping_profile_id" text null;
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                drop column if exists "sales_channel_id",
                drop column if exists "shipping_profile_id";
        `)
    }
}
