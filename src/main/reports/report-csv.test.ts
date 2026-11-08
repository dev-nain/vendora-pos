import { describe, expect, it } from "vitest";
import type { ReportSection } from "../../shared/discounts-returns-voids";
import type { ReportColumn, ReportFooterRow } from "../../shared/reports";
import { reportCsv, reportCsvSections } from "./report-csv";

type Row = {
  name: string;
  qty: number;
  amount: number | null;
  bills: number;
  day: string;
  share: number | null;
};

const columns: ReportColumn<Row>[] = [
  { key: "name", label: "Name", format: "text" },
  { key: "day", label: "Day", format: "day" },
  { key: "bills", label: "Bills", format: "count" },
  { key: "qty", label: "Qty", format: "quantity", unit: "kg" },
  { key: "amount", label: "Amount", format: "money" },
  { key: "share", label: "Share", format: "percent" },
];

const row = (overrides: Partial<Row> = {}): Row => ({
  name: "Tea",
  day: "2026-11-07",
  bills: 3,
  qty: 2500,
  amount: 12050,
  share: 4000,
  ...overrides,
});

const csv = (
  rows: Row[],
  totals: Record<string, number | null> = {},
  footer: ReportFooterRow[] = [],
) => reportCsv({ columns, rows, totals, totalsLabel: "Total", footer });

const lines = (text: string) => text.slice(1).split("\r\n");

describe("reportCsv", () => {
  it("starts with a BOM and uses CRLF with a header row", () => {
    const text = csv([row()]);
    expect(text.codePointAt(0)).toBe(0xfeff);
    expect(lines(text)[0]).toBe("Name,Day,Bills,Qty,Amount,Share");
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("writes numbers raw, days as ISO and no unit suffix", () => {
    expect(lines(csv([row()]))[1]).toBe("Tea,2026-11-07,3,2.5,120.50,40.00%");
  });

  it("keeps negative money and quantity numeric", () => {
    const [, data] = lines(csv([row({ amount: -12050, qty: -1500, bills: -1 })]));
    expect(data).toBe("Tea,2026-11-07,-1,-1.5,-120.50,40.00%");
  });

  it("writes five paisa as 0.05", () => {
    expect(lines(csv([row({ amount: 5 })]))[1]).toBe("Tea,2026-11-07,3,2.5,0.05,40.00%");
    expect(lines(csv([row({ amount: -5 })]))[1]).toBe("Tea,2026-11-07,3,2.5,-0.05,40.00%");
  });

  it("quotes commas, quotes and line breaks in text", () => {
    const [, data] = lines(csv([row({ name: 'Tea, "Loose"\r\nGreen' })]));
    expect(csv([row({ name: 'Tea, "Loose"\r\nGreen' })])).toContain('"Tea, ""Loose""\r\nGreen"');
    expect(data).toContain('"Tea, ""Loose""');
  });

  it.each(["=SUM(A1)", "+1", "-1", "@cmd"])("guards text starting with %s", (name) => {
    expect(lines(csv([row({ name })]))[1]?.startsWith(`'${name},`)).toBe(true);
  });

  it("quotes a header label with a comma", () => {
    const text = reportCsv({
      columns: [{ key: "name", label: "Name, full", format: "text" }],
      rows: [],
      totals: {},
      totalsLabel: "Total",
    });
    expect(lines(text)[0]).toBe('"Name, full"');
  });

  it("ends with a totals row labelled Total", () => {
    const text = csv([row()], { bills: 3, qty: 2500, amount: -12050 });
    expect(lines(text)[2]).toBe("Total,,3,2.5,-120.50,");
  });

  it("writes null cells as empty", () => {
    expect(lines(csv([row({ amount: null, share: null })]))[1]).toBe("Tea,2026-11-07,3,2.5,,");
  });

  it("writes percent with a leading minus, even below one percent", () => {
    expect(lines(csv([row({ share: -500 })]))[1]).toBe("Tea,2026-11-07,3,2.5,120.50,-5.00%");
    expect(lines(csv([row({ share: -7 })]))[1]).toBe("Tea,2026-11-07,3,2.5,120.50,-0.07%");
  });

  it("writes footer rows after the total, empty outside their columns", () => {
    const text = csv([row()], { amount: 12050, share: null }, [
      { label: "Rounding", values: { amount: -50 } },
    ]);
    expect(lines(text).slice(2, 4)).toEqual(["Total,,,,120.50,", "Rounding,,,,-0.50,"]);
  });
});

describe("reportCsvSections", () => {
  const sections: ReportSection[] = [
    {
      id: "discounts-by-user",
      title: "Discounts by user",
      rowKey: "userId",
      columns: [
        { key: "userName", label: "User", format: "text" },
        { key: "discountPaisa", label: "Discount", format: "money" },
      ],
      rows: [{ userId: "u1", userName: "Ayesha", discountPaisa: 1500 }],
      totals: { discountPaisa: 1500 },
      shown: 1,
      total: 1,
    },
    {
      id: "deleted-lines",
      title: "Deleted lines",
      rowKey: "auditId",
      columns: [
        { key: "createdAt", label: "Time", format: "time" },
        { key: "bill", label: "Bill", format: "invoice", linkKey: "invoiceNo" },
        { key: "qtyMilli", label: "Qty", format: "quantity", unitKey: "unit" },
      ],
      rows: [
        {
          auditId: "a1",
          createdAt: "2026-11-07T10:04:00.000Z",
          bill: "Discarded",
          invoiceNo: "",
          unit: "kg",
          qtyMilli: 1500,
        },
      ],
      totals: null,
      shown: 1,
      total: 1,
    },
  ];

  it("writes one titled block per table with a single BOM and a blank line between", () => {
    const text = reportCsvSections(sections);
    expect(text.codePointAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe(
      [
        "Discounts by user",
        "User,Discount",
        "Ayesha,15.00",
        "Total,15.00",
        "",
        "Deleted lines",
        "Time,Bill,Qty",
        "2026-11-07 15:04,Discarded,1.5",
        "",
      ].join("\r\n"),
    );
  });

  describe("row-unit, unit and date-time columns", () => {
    type StockRow = { product: string; unit: string; onHand: number; at: string };
    const stockColumns: ReportColumn<StockRow>[] = [
      { key: "product", label: "Product", format: "text" },
      { key: "unit", label: "Unit", format: "unit" },
      { key: "onHand", label: "On hand", format: "quantity", unitKey: "unit" },
      { key: "at", label: "Last movement", format: "datetime" },
    ];
    const stock = (rows: StockRow[], totals: Record<string, number> = {}) =>
      reportCsv({ columns: stockColumns, rows, totals, totalsLabel: "Total" });

    it("writes the unit suffix, the bare quantity and ISO-like store time", () => {
      const text = stock([
        { product: "Sugar", unit: "kg", onHand: -1500, at: "2026-11-07T10:05:00.000Z" },
        { product: "Tea", unit: "piece", onHand: 12000, at: "2026-11-07T19:30:00.000Z" },
      ]);
      expect(lines(text).slice(0, 3)).toEqual([
        "Product,Unit,On hand,Last movement",
        "Sugar,kg,-1.5,2026-11-07 15:05",
        "Tea,pcs,12,2026-11-08 00:30",
      ]);
    });

    it("leaves out the Total line when there are no totals", () => {
      const text = stock([
        { product: "Tea", unit: "piece", onHand: 1000, at: "2026-11-07T10:05:00.000Z" },
      ]);
      expect(lines(text)).toEqual([
        "Product,Unit,On hand,Last movement",
        "Tea,pcs,1,2026-11-07 15:05",
        "",
      ]);
    });
  });
});
