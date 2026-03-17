import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260314120000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            create unique index if not exists "IDX_contifico_entity_map_type_medusa_invoice_typed"
            on "contifico_entity_map" ("entity_type", "medusa_id")
            where deleted_at is null and entity_type = 'invoice' and medusa_id like '%:%';
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            drop index if exists "IDX_contifico_entity_map_type_medusa_invoice_typed";
        `)
    }
}
