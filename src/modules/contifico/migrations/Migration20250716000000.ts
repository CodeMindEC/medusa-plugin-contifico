import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20250716000000 extends Migration {
    async up(): Promise<void> {
        // Renombrar bodega_id → bodega_ids (sigue siendo text, ahora almacena CSV)
        this.addSql(`
      alter table "contifico_config"
        rename column "bodega_id" to "bodega_ids";
    `)
    }

    async down(): Promise<void> {
        this.addSql(`
      alter table "contifico_config"
        rename column "bodega_ids" to "bodega_id";
    `)
    }
}
