import { describe, expect, it } from "vitest";
import {
  salesByDayColumns,
  type ReportColumn,
  type SalesByDayRow,
  type SalesByPeriodTotals,
} from "../../shared/reports";
import type { ReceiptSettings } from "../../shared/settings";
import type { ReportSection } from "../../shared/discounts-returns-voids";
import { buildReportDocument, buildSectionedReportDocument } from "./report-document";

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

const totals: SalesByPeriodTotals = {
  billCount: 4,
  grossPaisa: 40500,
  returnsPaisa: 500,
  discountPaisa: 500,
  netPaisa: 40000,
  taxPaisa: 7200,
  roundingPaisa: -50,
  totalPaisa: 47150,
};

const row: SalesByDayRow = { day: "2026-11-07", ...totals };

type ProfitRow = {
  product: string;
  netPaisa: number;
  costPaisa: number | null;
  marginBps: number | null;
};

const profitColumns: ReportColumn<ProfitRow>[] = [
  { key: "product", label: "Product", format: "text" },
  { key: "netPaisa", label: "Net sales", format: "money" },
  { key: "costPaisa", label: "Cost", format: "money" },
  { key: "marginBps", label: "Margin", format: "percent" },
];

const build = (store_: ReceiptSettings = store) =>
  buildReportDocument({
    title: "Sales by day",
    reference: "1 Nov 2026 – 7 Nov 2026",
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
      ...Array.from({ length: 8 }, () => "right"),
    ]);
    expect(model.rows[0]?.map((cell) => cell.text)).toEqual([
      "7 Nov 2026",
      "4",
      "Rs 405",
      "Rs 5",
      "Rs 5",
      "Rs 400",
      "Rs 72",
      "−Rs 0.50",
      "Rs 471.50",
    ]);
    expect(model.totals).toHaveLength(8);
    expect(model.totals[0]).toEqual({ label: "Bills", value: "4" });
    expect(model.totals.at(-1)).toEqual({ label: "Total", value: "Rs 471.50" });
  });

  it("gives column widths as percentages that add up to 100", () => {
    const widths = build().columns.map((column) => Number.parseFloat(column.width ?? "0"));
    expect(widths.every((width) => width > 0)).toBe(true);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 0);
  });

  it("takes the reference line and extra facts from the caller", () => {
    const model = buildReportDocument({
      title: "Stock movements",
      reference: "Tea · 1 Nov 2026",
      facts: [{ label: "Opening balance", value: "0 pcs" }],
      store,
      columns: salesByDayColumns,
      rows: [],
      totals: {},
    });
    expect(model.reference).toBe("Tea · 1 Nov 2026");
    expect(model.facts).toEqual([
      { label: "Times", value: "Asia/Karachi" },
      { label: "Opening balance", value: "0 pcs" },
    ]);
  });

  it("formats row-unit quantities with the row's unit and keeps unit and date-time left", () => {
    type StockRow = { unit: string; onHand: number; at: string };
    const model = buildReportDocument<StockRow>({
      title: "Negative stock",
      reference: "As of 7 Nov 2026, 3:05 pm",
      store,
      columns: [
        { key: "unit", label: "Unit", format: "unit", width: "100px" },
        {
          key: "onHand",
          label: "On hand",
          format: "quantity",
          unitKey: "unit",
          bare: true,
          width: "100px",
        },
        { key: "at", label: "Last movement", format: "datetime", width: "100px" },
      ],
      rows: [{ unit: "kg", onHand: -1500, at: "2026-11-07T10:05:00.000Z" }],
      totals: {},
    });
    expect(model.columns.map((column) => column.align)).toEqual(["left", "right", "left"]);
    expect(model.rows[0]?.map((cell) => cell.text)).toEqual([
      "kg",
      "−1.500",
      "7 Nov 2026, 3:05 pm",
    ]);
    expect(model.totals).toEqual([]);
  });

  it("shows null cells and totals as a dash and appends footer rows", () => {
    const model = buildReportDocument({
      title: "Gross profit by product",
      reference: "7 Nov 2026",
      store,
      columns: profitColumns,
      rows: [
        { product: "Misc items (no cost)", netPaisa: 15000, costPaisa: null, marginBps: null },
      ],
      totals: { netPaisa: 15000, costPaisa: 0, marginBps: null },
      footer: [{ label: "Rounding", values: { netPaisa: -50 } }],
    });
    expect(model.rows[0]?.map((cell) => cell.text).slice(-2)).toEqual(["—", "—"]);
    expect(model.totals.find((total) => total.label === "Margin")).toEqual({
      label: "Margin",
      value: "—",
    });
    expect(model.totals.find((total) => total.label === "Rounding")).toEqual({
      label: "Rounding",
      value: "−Rs 0.50",
    });
    expect(model.columns).toHaveLength(4);
  });
});

describe("buildSectionedReportDocument", () => {
  const section: ReportSection = {
    id: "deleted-lines",
    title: "Deleted lines",
    rowKey: "auditId",
    columns: [
      { key: "createdAt", label: "Time", format: "time", width: "100px" },
      { key: "qtyMilli", label: "Qty", format: "quantity", unitKey: "unit", width: "50px" },
      { key: "grossPaisa", label: "Gross before discount", format: "money", width: "50px" },
    ],
    rows: [
      {
        auditId: "a1",
        createdAt: "2026-11-07T10:04:00.000Z",
        unit: "kg",
        qtyMilli: 1500,
        grossPaisa: 5000,
      },
    ],
    totals: { grossPaisa: 5000 },
    shown: 1,
    total: 340,
  };

  const model = buildSectionedReportDocument({
    title: "Discounts, returns and voids",
    range: { from: "2026-11-07", to: "2026-11-07" },
    store,
    sections: [section],
  });

  it("has the report frame and no main table", () => {
    expect(model).toMatchObject({
      title: "Discounts, returns and voids",
      reference: "7 Nov 2026",
      landscape: true,
      columns: [],
      rows: [],
      totals: [],
    });
    expect(model.facts).toEqual([{ label: "Times", value: "Asia/Karachi" }]);
  });

  it("fills a section with its heading, cells, totals and the cap note", () => {
    expect(model.sections).toEqual([
      {
        heading: "Deleted lines",
        columns: [
          { label: "Time", align: "left", width: "50.0%" },
          { label: "Qty", align: "right", width: "25.0%" },
          { label: "Gross before discount", align: "right", width: "25.0%" },
        ],
        rows: [[{ text: "7 Nov 2026, 15:04" }, { text: "1.500 kg" }, { text: "Rs 50" }]],
        totals: [{ label: "Gross before discount", value: "Rs 50" }],
        note: "Showing the latest 1 of 340. The CSV export has every row.",
      },
    ]);
  });

  it("leaves single-table documents without sections", () => {
    expect(build().sections).toBeUndefined();
  });
});
