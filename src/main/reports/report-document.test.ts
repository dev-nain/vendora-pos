import { describe, expect, it } from "vitest";
import { salesByDayColumns, type SalesByDayRow, type SalesByDayTotals } from "../../shared/reports";
import type { ReceiptSettings } from "../../shared/settings";
import { buildReportDocument } from "./report-document";

const store: ReceiptSettings = {
  name: "Noor General Store",
  address: "Main Bazaar, Lahore",
  phone: "042-111",
  ntn: "1234567-8",
  strn: null,
  headerEn: "Welcome",
  headerUr: null,
  footerEn: "Thanks",
  footerUr: null,
};

const emptyStore: ReceiptSettings = {
  name: null,
  address: " ",
  phone: null,
  ntn: null,
  strn: null,
  headerEn: null,
  headerUr: null,
  footerEn: null,
  footerUr: null,
};

const totals: SalesByDayTotals = {
  billCount: 4,
  pieceQtyMilli: 3000,
  kgQtyMilli: 1500,
  litreQtyMilli: 0,
  discountPaisa: 500,
  netPaisa: 40000,
  taxPaisa: 7200,
  roundingPaisa: -50,
  totalPaisa: 47150,
};

const row: SalesByDayRow = { day: "2026-11-07", ...totals };

const build = (store_: ReceiptSettings = store) =>
  buildReportDocument({
    title: "Sales by day",
    range: { from: "2026-11-01", to: "2026-11-07" },
    store: store_,
    columns: salesByDayColumns,
    rows: [row],
    totals,
  });

describe("buildReportDocument", () => {
  it("carries the title, range, time zone and landscape flag", () => {
    const model = build();
    expect(model.title).toBe("Sales by day");
    expect(model.reference).toBe("1 Nov 2026 – 7 Nov 2026");
    expect(model.facts).toEqual([{ label: "Times", value: "Asia/Karachi" }]);
    expect(model.landscape).toBe(true);
    expect(model.notes).toBeNull();
  });

  it("lists the store details in one panel", () => {
    expect(build().panels).toEqual([
      { lines: ["Noor General Store", "Main Bazaar, Lahore", "Phone: 042-111", "NTN: 1234567-8"] },
    ]);
  });

  it("has no panel for a store without details", () => {
    expect(build(emptyStore).panels).toEqual([]);
  });

  it("formats rows and totals, right-aligning numbers", () => {
    const model = build();
    expect(model.columns.map((column) => column.align)).toEqual([
      "left",
      ...Array.from({ length: 9 }, () => "right"),
    ]);
    expect(model.rows[0]?.map((cell) => cell.text)).toEqual([
      "7 Nov 2026",
      "4",
      "3 pcs",
      "1.500 kg",
      "0.000 L",
      "Rs 5",
      "Rs 400",
      "Rs 72",
      "−Rs 0.50",
      "Rs 471.50",
    ]);
    expect(model.totals).toHaveLength(9);
    expect(model.totals[0]).toEqual({ label: "Bills", value: "4" });
    expect(model.totals.at(-1)).toEqual({ label: "Total", value: "Rs 471.50" });
  });

  it("gives column widths as percentages that add up to 100", () => {
    const widths = build().columns.map((column) => Number.parseFloat(column.width ?? "0"));
    expect(widths.every((width) => width > 0)).toBe(true);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 0);
  });

  it("appends footer rows to the totals and honours a custom reference", () => {
    const model = buildReportDocument({
      title: "Sales by day",
      range: { from: "2026-11-01", to: "2026-11-07" },
      store,
      columns: salesByDayColumns,
      rows: [row],
      totals,
      footer: [{ label: "Rounding", values: { netPaisa: -50 } }],
      reference: "Shift 7 Nov 2026 09:00 – open",
    });
    expect(model.reference).toBe("Shift 7 Nov 2026 09:00 – open");
    expect(model.totals.at(-1)).toEqual({ label: "Rounding", value: "−Rs 0.50" });
  });
});
