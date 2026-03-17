import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260314010000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            drop index if exists "IDX_contifico_entity_map_type_medusa";
        `)

        this.addSql(`
            create unique index if not exists "IDX_contifico_entity_map_type_medusa_non_invoice"
            on "contifico_entity_map" ("entity_type", "medusa_id")
            where deleted_at is null and entity_type <> 'invoice';
        `)

        this.addSql(`
            create index if not exists "IDX_contifico_entity_map_type_medusa"
            on "contifico_entity_map" ("entity_type", "medusa_id")
            where deleted_at is null;
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            drop index if exists "IDX_contifico_entity_map_type_medusa_non_invoice";
        `)

        this.addSql(`
            drop index if exists "IDX_contifico_entity_map_type_medusa";
        `)

        this.addSql(`
            create unique index if not exists "IDX_contifico_entity_map_type_medusa"
            on "contifico_entity_map" ("entity_type", "medusa_id")
            where deleted_at is null;
        `)
    }
}
