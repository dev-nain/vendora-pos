import { describe, expect, it } from "vitest";
import type { ReportColumn } from "../../shared/reports";
import { reportCsv } from "./report-csv";

type Row = { name: string; qty: number; amount: number; bills: number; day: string };

const columns: ReportColumn<Row>[] = [
  { key: "name", label: "Name", format: "text" },
  { key: "day", label: "Day", format: "day" },
  { key: "bills", label: "Bills", format: "count" },
  { key: "qty", label: "Qty", format: "quantity", unit: "kg" },
  { key: "amount", label: "Amount", format: "money" },
];

const row = (overrides: Partial<Row> = {}): Row => ({
  name: "Tea",
  day: "2026-11-07",
  bills: 3,
  qty: 2500,
  amount: 12050,
  ...overrides,
});

const csv = (rows: Row[], totals: Record<string, number> = {}) =>
  reportCsv({ columns, rows, totals, totalsLabel: "Total" });

const lines = (text: string) => text.slice(1).split("\r\n");

describe("reportCsv", () => {
  it("starts with a BOM and uses CRLF with a header row", () => {
    const text = csv([row()]);
    expect(text.codePointAt(0)).toBe(0xfeff);
    expect(lines(text)[0]).toBe("Name,Day,Bills,Qty,Amount");
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("writes numbers raw, days as ISO and no unit suffix", () => {
    expect(lines(csv([row()]))[1]).toBe("Tea,2026-11-07,3,2.5,120.50");
  });

  it("keeps negative money and quantity numeric", () => {
    const [, data] = lines(csv([row({ amount: -12050, qty: -1500, bills: -1 })]));
    expect(data).toBe("Tea,2026-11-07,-1,-1.5,-120.50");
  });

  it("writes five paisa as 0.05", () => {
    expect(lines(csv([row({ amount: 5 })]))[1]).toBe("Tea,2026-11-07,3,2.5,0.05");
    expect(lines(csv([row({ amount: -5 })]))[1]).toBe("Tea,2026-11-07,3,2.5,-0.05");
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
    expect(lines(text)[2]).toBe("Total,,3,2.5,-120.50");
  });
});
