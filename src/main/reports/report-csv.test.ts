import { describe, expect, it } from "vitest";
import type { ReportColumn, ReportFooterRow } from "../../shared/reports";
import { reportCsv } from "./report-csv";

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
