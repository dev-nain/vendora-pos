import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "./client";
import { runMigrations } from "./migrate";

const migrationsFolder = join(process.cwd(), "drizzle");
const tag = "sale_line_category";

describe("sale line category migration", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-category-upgrade-"));
    database = openDatabase(join(dir, "vendora.db"));
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function migrateBeforeCategory(backupDir: string) {
    const oldFolder = join(dir, "old-migrations");
    mkdirSync(join(oldFolder, "meta"), { recursive: true });
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    const cut = journal.entries.findIndex((entry) => entry.tag.endsWith(tag));
    expect(cut).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, cut);
    writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) {
      copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(oldFolder, `${entry.tag}.sql`));
    }
    runMigrations(database, { migrationsFolder: oldFolder, backupDir });
  }

  it("backfills normal lines, leaves misc lines null and changes nothing else", () => {
    const backupDir = join(dir, "backups");
    migrateBeforeCategory(backupDir);
    database.sqlite.exec(`
      INSERT INTO stores (id, created_at, updated_at) VALUES ('s1', 1, 2);
      INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2);
      INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at) VALUES ('u1', 'owner', 'Owner', 'p', 'q', 1, 2);
      INSERT INTO categories (id, store_id, name, created_at, updated_at) VALUES ('c1', 's1', 'Tea', 1, 2);
      INSERT INTO categories (id, store_id, name, is_system, created_at, updated_at) VALUES ('c0', 's1', 'General', 1, 1, 2);
      INSERT INTO tax_categories (id, store_id, name, rate_bps, created_at, updated_at) VALUES ('x1', 's1', 'Standard', 1800, 1, 2);
      INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
        VALUES ('p1', 's1', 'Tapal', 'tapal', 'c1', 'x1', 'piece', 100, 150, 1, 2);
      INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, is_system, created_at, updated_at)
        VALUES ('p0', 's1', 'Misc', 'misc', 'c0', 'x1', 'piece', 0, 0, 1, 1, 2);
      INSERT INTO shifts (id, store_id, terminal_id, opened_by, opened_at, opening_float_paisa, created_at, updated_at)
        VALUES ('sh1', 's1', 't1', 'u1', 1, 0, 1, 2);
      INSERT INTO bill_drafts (id, store_id, terminal_id, shift_id, created_by, created_at, updated_at)
        VALUES ('d1', 's1', 't1', 'sh1', 'u1', 1, 1);
      INSERT INTO sales (id, store_id, terminal_id, shift_id, draft_id, invoice_no, type, cashier_user_id, prices_include_tax, subtotal_paisa, discount_paisa, tax_paisa, rounding_paisa, total_paisa, created_at)
        VALUES ('sale1', 's1', 't1', 'sh1', 'd1', 'T1-1', 'sale', 'u1', 1, 300, 0, 46, 0, 300, 1);
      INSERT INTO sale_lines (id, store_id, terminal_id, sale_id, position, product_id, name_en, unit, qty_milli, is_return, unit_price_paisa, cost_paisa, tax_rate_bps, is_third_schedule, gross_paisa, line_discount_paisa, bill_discount_paisa, discount_paisa, tax_paisa, total_paisa, created_at)
        VALUES ('l1', 's1', 't1', 'sale1', 0, 'p1', 'Tapal', 'piece', 1000, 0, 150, 100, 1800, 0, 150, 0, 0, 0, 23, 150, 1),
               ('l2', 's1', 't1', 'sale1', 1, 'p0', 'Loose', 'piece', 1000, 0, 150, 0, 1800, 0, 150, 0, 0, 0, 23, 150, 1);
    `);
    const lines = () =>
      database.sqlite
        .prepare(
          "SELECT id, sale_id, position, product_id, name_en, unit, qty_milli, unit_price_paisa, cost_paisa, tax_rate_bps, total_paisa, created_at FROM sale_lines ORDER BY id",
        )
        .all();
    const before = lines();

    expect(runMigrations(database, { migrationsFolder, backupDir })).toBe("migrated");

    expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
    expect(lines()).toEqual(before);
    expect(
      database.sqlite
        .prepare("SELECT id, category_id, category_name FROM sale_lines ORDER BY id")
        .all(),
    ).toEqual([
      { id: "l1", category_id: "c1", category_name: "Tea" },
      { id: "l2", category_id: null, category_name: null },
    ]);
    expect(database.sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});
