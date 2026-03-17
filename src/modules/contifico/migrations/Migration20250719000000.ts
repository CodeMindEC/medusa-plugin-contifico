import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20250719000000 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                add column if not exists "import_filters" text null;
        `)
    }

    async down(): Promise<void> {
        this.addSql(`
            alter table "contifico_config"
                drop column if exists "import_filters";
        `)
    }
}
