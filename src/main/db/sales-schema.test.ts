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

type Row = Record<string, string | number | null>;

const insert = (database: VendoraDatabase, table: string, row: Row) => {
  const columns = Object.keys(row);
  database.sqlite
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...Object.values(row));
};

const failsWith = (action: () => void, code: string) => {
  try {
    action();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

const seedBase = (database: VendoraDatabase) => {
  database.sqlite.exec(`
    INSERT INTO stores (id, created_at, updated_at) VALUES ('s1', 1, 2);
    INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2);
    INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at) VALUES ('u1', 'owner', 'Owner', 'p', 'q', 1, 2);
    INSERT INTO categories (id, store_id, name, created_at, updated_at) VALUES ('c1', 's1', 'Tea', 1, 2);
    INSERT INTO tax_categories (id, store_id, name, rate_bps, created_at, updated_at) VALUES ('x1', 's1', 'Standard', 1800, 1, 2);
    INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
      VALUES ('p1', 's1', 'Tapal', 'tapal', 'c1', 'x1', 'piece', 100, 150, 1, 2);
    INSERT INTO shifts (id, store_id, terminal_id, opened_by, opened_at, opening_float_paisa, created_at, updated_at)
      VALUES ('sh1', 's1', 't1', 'u1', 1, 0, 1, 2);
  `);
};

const draftRow = (id: string, overrides: Row = {}): Row => ({
  id,
  store_id: "s1",
  terminal_id: "t1",
  shift_id: "sh1",
  created_by: "u1",
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

const draftLineRow = (id: string, overrides: Row = {}): Row => ({
  id,
  store_id: "s1",
  terminal_id: "t1",
  draft_id: "d1",
  position: 0,
  product_id: "p1",
  qty_milli: 1000,
  unit_price_paisa: 150,
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

const saleRow = (id: string, overrides: Row = {}): Row => ({
  id,
  store_id: "s1",
  terminal_id: "t1",
  shift_id: "sh1",
  draft_id: `d-${id}`,
  invoice_no: `T1-${id}`,
  type: "sale",
  cashier_user_id: "u1",
  prices_include_tax: 1,
  subtotal_paisa: 150,
  discount_paisa: 0,
  tax_paisa: 23,
  rounding_paisa: 0,
  total_paisa: 150,
  created_at: 1,
  ...overrides,
});

const lineRow = (id: string, saleId: string, overrides: Row = {}): Row => ({
  id,
  store_id: "s1",
  terminal_id: "t1",
  sale_id: saleId,
  position: 0,
  product_id: "p1",
  name_en: "Tapal",
  unit: "piece",
  qty_milli: 1000,
  is_return: 0,
  unit_price_paisa: 150,
  cost_paisa: 100,
  tax_rate_bps: 1800,
  is_third_schedule: 0,
  gross_paisa: 150,
  line_discount_paisa: 0,
  bill_discount_paisa: 0,
  discount_paisa: 0,
  tax_paisa: 23,
  total_paisa: 150,
  created_at: 1,
  ...overrides,
});

const paymentRow = (id: string, saleId: string, overrides: Row = {}): Row => ({
  id,
  store_id: "s1",
  terminal_id: "t1",
  sale_id: saleId,
  position: 0,
  method: "cash",
  amount_paisa: 150,
  cashier_user_id: "u1",
  created_at: 1,
  ...overrides,
});

const check = (action: () => void) => failsWith(action, "SQLITE_CONSTRAINT_CHECK");
const foreignKey = (action: () => void) => failsWith(action, "SQLITE_CONSTRAINT_FOREIGNKEY");
const unique = (action: () => void) => failsWith(action, "SQLITE_CONSTRAINT_UNIQUE");

const returnLine = (position: number, extra: Row): Row => ({
  position,
  is_return: 1,
  qty_milli: -1000,
  gross_paisa: -150,
  tax_paisa: -23,
  total_paisa: -150,
  ...extra,
});

describe("sales schema", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-sales-schema-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, { migrationsFolder, backupDir: join(dir, "backups") });
    seedBase(database);
    insert(database, "bill_drafts", draftRow("d1"));
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const addSale = (id: string, overrides: Row = {}) => {
    insert(database, "bill_drafts", draftRow(`d-${id}`));
    insert(database, "sales", saleRow(id, overrides));
  };

  describe("store, product and terminal columns", () => {
    it("fills the defaults", () => {
      expect(
        database.sqlite
          .prepare(
            "SELECT prices_include_tax AS a, cash_rounding_enabled AS b, cash_rounding_paisa AS c, cash_rounding_cash_only AS d FROM stores",
          )
          .get(),
      ).toEqual({ a: 1, b: 0, c: 100, d: 1 });
      expect(database.sqlite.prepare("SELECT is_third_schedule AS v FROM products").get()).toEqual({
        v: 0,
      });
      expect(database.sqlite.prepare("SELECT fbr_pos_id AS v FROM terminals").get()).toEqual({
        v: null,
      });
    });

    it("rejects a cash rounding step of 0, a negative or a fraction", () => {
      for (const value of [0, -100, 1.5]) {
        check(() =>
          database.sqlite.prepare("UPDATE stores SET cash_rounding_paisa = ?").run(value),
        );
      }
      expect(() =>
        database.sqlite.prepare("UPDATE stores SET cash_rounding_paisa = 500").run(),
      ).not.toThrow();
    });
  });

  describe("integer checks", () => {
    const cases: [string, () => Row, string[]][] = [
      [
        "bill_drafts",
        () => draftRow("df", { bill_discount_kind: "amount", bill_discount_value: 5 }),
        ["bill_discount_value"],
      ],
      [
        "bill_draft_lines",
        () => draftLineRow("dlf", { line_discount_kind: "amount", line_discount_value: 5 }),
        ["position", "qty_milli", "unit_price_paisa", "line_discount_value", "pack_qty_milli"],
      ],
      [
        "sales",
        () => saleRow("sf", { draft_id: "d1" }),
        [
          "subtotal_paisa",
          "discount_paisa",
          "tax_paisa",
          "rounding_paisa",
          "total_paisa",
          "deleted_line_count",
        ],
      ],
      [
        "sale_lines",
        () => lineRow("lf", "sale1", { mrp_paisa: 160 }),
        [
          "position",
          "qty_milli",
          "unit_price_paisa",
          "mrp_paisa",
          "cost_paisa",
          "tax_rate_bps",
          "gross_paisa",
          "line_discount_paisa",
          "bill_discount_paisa",
          "discount_paisa",
          "tax_paisa",
          "total_paisa",
          "pack_qty_milli",
        ],
      ],
      ["sale_payments", () => paymentRow("pf", "sale1"), ["position", "amount_paisa"]],
    ];

    it.each(cases)("rejects 1.5 in every integer column of %s", (table, base, columns) => {
      addSale("sale1");
      for (const column of columns) {
        const row = base();
        row[column] = 1.5;
        if (table === "sales") row.draft_id = "d1";
        check(() => insert(database, table, row));
      }
    });

    it("rejects 1.5 in the invoice sequence", () => {
      check(() =>
        insert(database, "terminal_invoice_sequences", {
          terminal_id: "t1",
          store_id: "s1",
          next_seq: 1.5,
          created_at: 1,
          updated_at: 1,
        }),
      );
    });

    it("accepts the unmodified base rows", () => {
      addSale("sale1");
      expect(() => insert(database, "sale_lines", lineRow("l1", "sale1"))).not.toThrow();
      expect(() => insert(database, "sale_payments", paymentRow("p1", "sale1"))).not.toThrow();
      expect(() => insert(database, "bill_draft_lines", draftLineRow("dl1"))).not.toThrow();
    });
  });

  describe("sale lines", () => {
    beforeEach(() => addSale("sale1"));

    const amounts = [
      "gross_paisa",
      "line_discount_paisa",
      "bill_discount_paisa",
      "tax_paisa",
      "total_paisa",
    ];

    it("requires a positive quantity and non-negative amounts on a normal line", () => {
      check(() => insert(database, "sale_lines", lineRow("a", "sale1", { qty_milli: -1000 })));
      check(() => insert(database, "sale_lines", lineRow("b", "sale1", { qty_milli: 0 })));
      for (const column of amounts) {
        const value = column === "line_discount_paisa" ? -5 : -1;
        const overrides: Row = { [column]: value };
        if (column.endsWith("discount_paisa") && column !== "discount_paisa") {
          overrides.discount_paisa = value;
        }
        check(() => insert(database, "sale_lines", lineRow(`n-${column}`, "sale1", overrides)));
      }
    });

    it("requires a negative quantity and non-positive amounts on a return line", () => {
      const ret: Row = {
        is_return: 1,
        qty_milli: -1000,
        gross_paisa: -150,
        tax_paisa: -23,
        total_paisa: -150,
      };
      expect(() => insert(database, "sale_lines", lineRow("r1", "sale1", ret))).not.toThrow();
      check(() =>
        insert(
          database,
          "sale_lines",
          lineRow("r2", "sale1", { ...ret, position: 1, qty_milli: 1000 }),
        ),
      );
      check(() =>
        insert(
          database,
          "sale_lines",
          lineRow("r3", "sale1", { ...ret, position: 2, tax_paisa: 23 }),
        ),
      );
      check(() =>
        insert(
          database,
          "sale_lines",
          lineRow("r4", "sale1", { ...ret, position: 3, total_paisa: 1 }),
        ),
      );
    });

    it("keeps price, cost, MRP and tax rate non-negative", () => {
      check(() => insert(database, "sale_lines", lineRow("a", "sale1", { unit_price_paisa: -1 })));
      check(() => insert(database, "sale_lines", lineRow("b", "sale1", { cost_paisa: -1 })));
      check(() => insert(database, "sale_lines", lineRow("c", "sale1", { mrp_paisa: -1 })));
      check(() => insert(database, "sale_lines", lineRow("d", "sale1", { tax_rate_bps: -1 })));
      check(() => insert(database, "sale_lines", lineRow("e", "sale1", { tax_rate_bps: 10001 })));
      check(() => insert(database, "sale_lines", lineRow("f", "sale1", { pack_qty_milli: 0 })));
    });

    it("requires discount to equal line plus bill discount", () => {
      check(() =>
        insert(
          database,
          "sale_lines",
          lineRow("a", "sale1", {
            line_discount_paisa: 5,
            bill_discount_paisa: 3,
            discount_paisa: 7,
          }),
        ),
      );
      expect(() =>
        insert(
          database,
          "sale_lines",
          lineRow("b", "sale1", {
            line_discount_paisa: 5,
            bill_discount_paisa: 3,
            discount_paisa: 8,
          }),
        ),
      ).not.toThrow();
    });

    it("rejects a unit outside the product units and a duplicate position", () => {
      check(() => insert(database, "sale_lines", lineRow("a", "sale1", { unit: "box" })));
      insert(database, "sale_lines", lineRow("b", "sale1"));
      unique(() => insert(database, "sale_lines", lineRow("c", "sale1")));
    });

    it("rejects a refunded line on a non-return line and an unpaired refund link", () => {
      addSale("refund1", { type: "refund", total_paisa: -150, refunded_sale_id: "sale1" });
      insert(database, "sale_lines", lineRow("orig", "sale1"));
      const ret: Row = {
        is_return: 1,
        qty_milli: -1000,
        gross_paisa: -150,
        tax_paisa: -23,
        total_paisa: -150,
      };
      check(() =>
        insert(
          database,
          "sale_lines",
          lineRow("x1", "refund1", { refunded_sale_id: "sale1", refunded_line_id: "orig" }),
        ),
      );
      check(() =>
        insert(
          database,
          "sale_lines",
          lineRow("x2", "refund1", { ...ret, refunded_line_id: "orig" }),
        ),
      );
      check(() =>
        insert(
          database,
          "sale_lines",
          lineRow("x3", "refund1", { ...ret, refunded_sale_id: "sale1" }),
        ),
      );
    });

    it("accepts a return line with no receipt", () => {
      addSale("refund1", { type: "refund", total_paisa: -150 });
      expect(() =>
        insert(
          database,
          "sale_lines",
          lineRow("r", "refund1", {
            is_return: 1,
            qty_milli: -1000,
            gross_paisa: -150,
            tax_paisa: -23,
            total_paisa: -150,
          }),
        ),
      ).not.toThrow();
    });
  });

  describe("refund lines", () => {
    beforeEach(() => {
      addSale("A");
      addSale("B");
      insert(database, "sale_lines", lineRow("lineA", "A"));
      insert(database, "sale_lines", lineRow("lineB", "B"));
      addSale("R", { type: "refund", total_paisa: -150, refunded_sale_id: "A" });
      addSale("N", { type: "refund", total_paisa: -150 });
    });

    it("accepts a refund line pointing at a line of the refunded sale", () => {
      expect(() =>
        insert(
          database,
          "sale_lines",
          lineRow("ok", "R", returnLine(0, { refunded_sale_id: "A", refunded_line_id: "lineA" })),
        ),
      ).not.toThrow();
    });

    it("rejects a refund line pointing at a line on another sale", () => {
      foreignKey(() =>
        insert(
          database,
          "sale_lines",
          lineRow("bad", "R", returnLine(0, { refunded_sale_id: "A", refunded_line_id: "lineB" })),
        ),
      );
      foreignKey(() =>
        insert(
          database,
          "sale_lines",
          lineRow("bad2", "R", returnLine(0, { refunded_sale_id: "B", refunded_line_id: "lineB" })),
        ),
      );
    });

    it("rejects a receipt-linked line on a sale with no refunded sale", () => {
      foreignKey(() =>
        insert(
          database,
          "sale_lines",
          lineRow("bad", "N", returnLine(0, { refunded_sale_id: "A", refunded_line_id: "lineA" })),
        ),
      );
    });
  });

  describe("sales", () => {
    it("makes draft_id unique", () => {
      addSale("a", { draft_id: "d1" });
      unique(() => insert(database, "sales", saleRow("b", { draft_id: "d1" })));
    });

    it("keeps invoice numbers unique per terminal", () => {
      addSale("a", { invoice_no: "T1-000001" });
      insert(database, "bill_drafts", draftRow("d-b"));
      unique(() => insert(database, "sales", saleRow("b", { invoice_no: "T1-000001" })));
      database.sqlite.exec(
        "INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t2', 's1', 'T2', 1, 2)",
      );
      expect(() =>
        insert(
          database,
          "sales",
          saleRow("c", { draft_id: "d-b", invoice_no: "T1-000001", terminal_id: "t2" }),
        ),
      ).not.toThrow();
    });

    it("ties the type to the sign of the total", () => {
      insert(database, "bill_drafts", draftRow("d-x"));
      check(() => insert(database, "sales", saleRow("x", { total_paisa: -1 })));
      check(() => insert(database, "sales", saleRow("x", { type: "refund", total_paisa: 1 })));
      check(() => insert(database, "sales", saleRow("x", { type: "refund", total_paisa: 0 })));
      check(() => insert(database, "sales", saleRow("x", { type: "void" })));
      expect(() => insert(database, "sales", saleRow("x", { total_paisa: 0 }))).not.toThrow();
    });

    it("rejects an empty invoice number, a negative deleted count and a self refund", () => {
      insert(database, "bill_drafts", draftRow("d-x"));
      check(() => insert(database, "sales", saleRow("x", { invoice_no: "" })));
      check(() => insert(database, "sales", saleRow("x", { deleted_line_count: -1 })));
      check(() => insert(database, "sales", saleRow("x", { refunded_sale_id: "x" })));
    });

    it("looks a sale up by invoice number through an index", () => {
      const detail = (
        database.sqlite
          .prepare(
            "EXPLAIN QUERY PLAN SELECT * FROM sales WHERE invoice_no = ? AND terminal_id = ?",
          )
          .all("T1-000001", "t1") as { detail: string }[]
      )
        .map((row) => row.detail)
        .join(" ");
      expect(detail).toContain("USING INDEX");
      expect(detail).not.toContain("SCAN");
    });
  });

  describe("payments", () => {
    beforeEach(() => {
      addSale("sale1");
      addSale("sale2");
    });

    it("rejects a zero amount, an unknown method and a bad change row", () => {
      check(() => insert(database, "sale_payments", paymentRow("a", "sale1", { amount_paisa: 0 })));
      check(() =>
        insert(database, "sale_payments", paymentRow("b", "sale1", { method: "cheque" })),
      );
      check(() =>
        insert(
          database,
          "sale_payments",
          paymentRow("c", "sale1", { is_change: 1, amount_paisa: 50 }),
        ),
      );
      check(() =>
        insert(
          database,
          "sale_payments",
          paymentRow("d", "sale1", { is_change: 1, method: "card", amount_paisa: -50 }),
        ),
      );
      expect(() =>
        insert(
          database,
          "sale_payments",
          paymentRow("e", "sale1", { is_change: 1, amount_paisa: -50 }),
        ),
      ).not.toThrow();
    });

    it("accepts the wallet methods", () => {
      insert(
        database,
        "sale_payments",
        paymentRow("a", "sale1", { method: "jazzcash", position: 0 }),
      );
      insert(
        database,
        "sale_payments",
        paymentRow("b", "sale1", { method: "easypaisa", position: 1 }),
      );
    });

    it("rejects a cash reference and a reference over 64 characters", () => {
      check(() => insert(database, "sale_payments", paymentRow("a", "sale1", { reference: "R1" })));
      check(() =>
        insert(
          database,
          "sale_payments",
          paymentRow("b", "sale1", { method: "card", reference: "x".repeat(65) }),
        ),
      );
      check(() =>
        insert(
          database,
          "sale_payments",
          paymentRow("c", "sale1", { method: "card", reference: "" }),
        ),
      );
      expect(() =>
        insert(
          database,
          "sale_payments",
          paymentRow("d", "sale1", { method: "card", reference: "x".repeat(64) }),
        ),
      ).not.toThrow();
    });

    it("accepts a reversal on the same sale and method, once", () => {
      insert(database, "sale_payments", paymentRow("orig", "sale1", { method: "card" }));
      const reversal = (id: string, overrides: Row = {}) =>
        paymentRow(id, "sale1", {
          position: 1,
          method: "card",
          amount_paisa: -150,
          reverses_payment_id: "orig",
          ...overrides,
        });
      expect(() => insert(database, "sale_payments", reversal("rev1"))).not.toThrow();
      unique(() => insert(database, "sale_payments", reversal("rev2", { position: 2 })));
    });

    it("rejects a reversal on another sale or with another method", () => {
      insert(database, "sale_payments", paymentRow("orig", "sale1", { method: "card" }));
      foreignKey(() =>
        insert(
          database,
          "sale_payments",
          paymentRow("r1", "sale2", {
            method: "card",
            amount_paisa: -150,
            reverses_payment_id: "orig",
          }),
        ),
      );
      foreignKey(() =>
        insert(
          database,
          "sale_payments",
          paymentRow("r2", "sale1", {
            position: 1,
            method: "bank_transfer",
            amount_paisa: -150,
            reverses_payment_id: "orig",
          }),
        ),
      );
    });
  });

  describe("bill drafts", () => {
    it("rejects unknown states and half-set or out-of-range discounts", () => {
      check(() => insert(database, "bill_drafts", draftRow("a", { state: "open" })));
      check(() => insert(database, "bill_drafts", draftRow("b", { bill_discount_kind: "amount" })));
      check(() => insert(database, "bill_drafts", draftRow("c", { bill_discount_value: 5 })));
      check(() =>
        insert(
          database,
          "bill_drafts",
          draftRow("d", { bill_discount_kind: "amount", bill_discount_value: -1 }),
        ),
      );
      check(() =>
        insert(
          database,
          "bill_drafts",
          draftRow("e", { bill_discount_kind: "percent", bill_discount_value: 10001 }),
        ),
      );
      expect(() =>
        insert(
          database,
          "bill_drafts",
          draftRow("f", { bill_discount_kind: "percent", bill_discount_value: 10000 }),
        ),
      ).not.toThrow();
    });
  });

  describe("bill draft lines", () => {
    it("enforces the quantity sign, price, pack size and discount rules", () => {
      check(() => insert(database, "bill_draft_lines", draftLineRow("a", { qty_milli: -1000 })));
      check(() => insert(database, "bill_draft_lines", draftLineRow("b", { is_return: 1 })));
      check(() =>
        insert(database, "bill_draft_lines", draftLineRow("c", { unit_price_paisa: -1 })),
      );
      check(() => insert(database, "bill_draft_lines", draftLineRow("d", { pack_qty_milli: 0 })));
      check(() => insert(database, "bill_draft_lines", draftLineRow("e", { price_type: "free" })));
      check(() =>
        insert(database, "bill_draft_lines", draftLineRow("f", { scale_source: "label" })),
      );
      check(() =>
        insert(database, "bill_draft_lines", draftLineRow("g", { line_discount_kind: "percent" })),
      );
      check(() =>
        insert(
          database,
          "bill_draft_lines",
          draftLineRow("h", { line_discount_kind: "percent", line_discount_value: 10001 }),
        ),
      );
    });

    it("keeps the deleted pair together and positions unique per draft", () => {
      check(() => insert(database, "bill_draft_lines", draftLineRow("a", { deleted_at: 5 })));
      check(() => insert(database, "bill_draft_lines", draftLineRow("b", { deleted_by: "u1" })));
      insert(database, "bill_draft_lines", draftLineRow("c", { deleted_at: 5, deleted_by: "u1" }));
      unique(() => insert(database, "bill_draft_lines", draftLineRow("d")));
    });

    it("rejects a refunded line on a non-return line", () => {
      addSale("sale1");
      insert(database, "sale_lines", lineRow("orig", "sale1"));
      check(() =>
        insert(database, "bill_draft_lines", draftLineRow("a", { refunded_line_id: "orig" })),
      );
      expect(() =>
        insert(
          database,
          "bill_draft_lines",
          draftLineRow("b", { is_return: 1, qty_milli: -1000, refunded_line_id: "orig" }),
        ),
      ).not.toThrow();
    });
  });

  describe("receipt prints and invoice sequence", () => {
    it("stores a print against a sale", () => {
      addSale("sale1");
      expect(() =>
        insert(database, "receipt_prints", {
          id: "rp1",
          store_id: "s1",
          terminal_id: "t1",
          sale_id: "sale1",
          printed_by: "u1",
          created_at: 1,
        }),
      ).not.toThrow();
    });

    it("keeps next_seq at 1 or more", () => {
      check(() =>
        insert(database, "terminal_invoice_sequences", {
          terminal_id: "t1",
          store_id: "s1",
          next_seq: 0,
          created_at: 1,
          updated_at: 1,
        }),
      );
    });
  });
});

describe("sales migration upgrade", () => {
  it("keeps every row, backs up first and fills the new defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "vendora-sales-upgrade-"));
    const old = openDatabase(join(dir, "vendora.db"));
    try {
      const oldFolder = join(dir, "old-migrations");
      mkdirSync(join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      journal.entries = journal.entries.slice(0, 11);
      writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        copyFileSync(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(oldFolder, `${entry.tag}.sql`),
        );
      }
      const backupDir = join(dir, "backups");
      runMigrations(old, { migrationsFolder: oldFolder, backupDir });
      seedBase(old);
      old.sqlite.exec(`
        INSERT INTO product_barcodes (id, store_id, product_id, barcode, created_at, updated_at) VALUES ('b1', 's1', 'p1', '8961001', 1, 2);
        INSERT INTO shifts (id, store_id, terminal_id, opened_by, opened_at, opening_float_paisa, closed_by, closed_at, counted_cash_paisa, expected_cash_paisa, variance_paisa, created_at, updated_at)
          VALUES ('sh0', 's1', 't1', 'u1', 0, 500, 'u1', 1, 700, 700, 0, 1, 2);
        INSERT INTO shift_cash_moves (id, store_id, terminal_id, shift_id, kind, amount_paisa, reason, created_by, created_at, updated_at)
          VALUES ('m1', 's1', 't1', 'sh1', 'in', 200, 'float', 'u1', 1, 2);
        INSERT INTO stock_movements (id, store_id, terminal_id, product_id, type, qty_milli, unit_cost_paisa, actor_user_id, created_at)
          VALUES ('sm1', 's1', 't1', 'p1', 'opening', 5000, 100, 'u1', 1);
      `);
      const snapshot = () => ({
        stores: old.sqlite
          .prepare("SELECT id, standard_tax_rate_bps, shift_variance_warn_paisa FROM stores")
          .all(),
        terminals: old.sqlite.prepare("SELECT id, code FROM terminals").all(),
        users: old.sqlite.prepare("SELECT id, username FROM users").all(),
        products: old.sqlite
          .prepare("SELECT id, name_en, cost_paisa, sale_price_paisa FROM products")
          .all(),
        barcodes: old.sqlite.prepare("SELECT id, barcode FROM product_barcodes").all(),
        shifts: old.sqlite
          .prepare(
            "SELECT id, opening_float_paisa, closed_at, counted_cash_paisa FROM shifts ORDER BY id",
          )
          .all(),
        moves: old.sqlite.prepare("SELECT id, kind, amount_paisa FROM shift_cash_moves").all(),
        stock: old.sqlite
          .prepare("SELECT id, qty_milli, unit_cost_paisa FROM stock_movements")
          .all(),
      });
      const before = snapshot();

      expect(runMigrations(old, { migrationsFolder, backupDir })).toBe("migrated");

      expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
      expect(snapshot()).toEqual(before);
      expect(
        old.sqlite
          .prepare(
            "SELECT prices_include_tax AS a, cash_rounding_enabled AS b, cash_rounding_paisa AS c, cash_rounding_cash_only AS d FROM stores",
          )
          .get(),
      ).toEqual({ a: 1, b: 0, c: 100, d: 1 });
      expect(old.sqlite.prepare("SELECT is_third_schedule AS v FROM products").get()).toEqual({
        v: 0,
      });
      expect(old.sqlite.prepare("SELECT fbr_pos_id AS v FROM terminals").get()).toEqual({
        v: null,
      });
      expect(old.sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(old.sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      old.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
