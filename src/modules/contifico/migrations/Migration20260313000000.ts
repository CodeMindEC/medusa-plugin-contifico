import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260313000000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                add column if not exists "weighted_pvp_field" text not null default 'pvp1';
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                drop column if exists "weighted_pvp_field";
        `)
    }
}
