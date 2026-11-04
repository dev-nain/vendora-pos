import { describe, expect, it } from "vitest";
import type { ReceiptBlock } from "../../shared/receipt";
import type { ReceiptSettings } from "../../shared/settings";
import type { ShiftReport } from "../../shared/shifts";
import { buildShiftReportModel } from "./shift-report-model";

const store: ReceiptSettings = {
  name: "Al Noor Store",
  address: null,
  phone: null,
  ntn: null,
  strn: null,
  headerEn: null,
  headerUr: null,
  footerEn: null,
  footerUr: null,
};

const opened = new Date(2026, 9, 27, 9, 0);
const moved = new Date(2026, 9, 27, 11, 30);

const report = (patch: Partial<ShiftReport> = {}): ShiftReport => ({
  kind: "x",
  shiftId: "sh1",
  terminalCode: "T1",
  openedBy: "Ayesha",
  openedAt: opened.toISOString(),
  closedBy: null,
  closedAt: null,
  openingFloatPaisa: 500000,
  sales: {
    billCount: 3,
    refundBillCount: 1,
    totalPaisa: 70000,
    byMethod: [
      { method: "cash", label: "Cash", amountPaisa: 50000 },
      { method: "card", label: "Card", amountPaisa: 20000 },
    ],
  },
  taxes: [{ rateBps: 1800, taxablePaisa: 59322, taxPaisa: 10678 }],
  discounts: { count: 1, amountPaisa: 1000 },
  refunds: { count: 1, amountPaisa: 5000 },
  deletedLines: { count: 2 },
  discardedBills: { count: 1 },
  cashIn: {
    moves: [
      {
        id: "m1",
        kind: "in",
        amountPaisa: 20000,
        reason: "Change float",
        createdBy: { id: "u1", displayName: "Ayesha" },
        createdAt: moved.toISOString(),
      },
    ],
    totalPaisa: 20000,
  },
  cashOut: { moves: [], totalPaisa: 0 },
  expectedByMethod: [
    { method: "cash", label: "Cash", expectedPaisa: 570000 },
    { method: "card", label: "Card", expectedPaisa: 20000 },
  ],
  expectedCashPaisa: 570000,
  count: null,
  variancePaisa: null,
  note: null,
  ...patch,
});

const rows = (blocks: ReceiptBlock[]): string[] =>
  blocks.flatMap((block) => {
    if (block.type === "text") return [block.text];
    if (block.type === "pair") return [`${block.left}|${block.right}`];
    if (block.type === "table") return block.rows.map((row) => row.join("|"));
    return [];
  });

describe("buildShiftReportModel", () => {
  it("titles an X-report and lists every section of the report view", () => {
    const model = buildShiftReportModel(report(), store, 576);
    const out = rows(model.blocks);

    expect(model.widthPx).toBe(576);
    expect(out).toContain("Al Noor Store");
    expect(out).toContain("X-report");
    expect(out).toContain("Terminal|T1");
    expect(out).toContain("Opened|27-10-2026 9:00 AM");
    expect(out).toContain("3 bills · 1 refund");
    expect(out).toContain("Cash|Rs 500");
    expect(out).toContain("Total sales|Rs 700");
    expect(out).toContain("18%|Rs 593.22|Rs 106.78");
    expect(out).toContain("1 bill|Rs 10");
    expect(out).toContain("1 line|−Rs 50");
    expect(out).toContain("Float|Rs 5,000");
    expect(out).toContain("11:30 AM Change float|Rs 200");
    expect(out).toContain("Cash|Rs 5,700");
    expect(out).toContain("Deleted lines|2");
    expect(out).toContain("Discarded bills|1");
    expect(out).not.toContain("Counted cash");
  });

  it("adds the close details, count and variance on a Z-report", () => {
    const closed = new Date(2026, 9, 27, 21, 15);
    const z = report({
      kind: "z",
      closedBy: "Bilal",
      closedAt: closed.toISOString(),
      count: {
        method: "denominations",
        lines: [{ valuePaisa: 500000, count: 1, totalPaisa: 500000 }],
        countedCashPaisa: 565000,
      },
      variancePaisa: -5000,
      note: "Short on coins",
    });

    const out = rows(buildShiftReportModel(z, store, 384).blocks);

    expect(out).toContain("Z-report");
    expect(out).toContain("Closed|27-10-2026 9:15 PM");
    expect(out).toContain("by Bilal");
    expect(out).toContain("Rs 5,000 × 1|Rs 5,000");
    expect(out).toContain("Counted|Rs 5,650");
    expect(out).toContain("Variance|Short Rs 50");
    expect(out).toContain("Short on coins");
  });

  it("shows None for empty sections and a total-only count", () => {
    const empty = report({
      taxes: [],
      kind: "z",
      closedBy: "Bilal",
      closedAt: opened.toISOString(),
      count: { method: "total", lines: [], countedCashPaisa: 570000 },
      variancePaisa: 0,
    });

    const out = rows(buildShiftReportModel(empty, store, 576).blocks);

    expect(out.filter((row) => row === "None")).toHaveLength(2);
    expect(out).toContain("Entered as a total");
    expect(out).toContain("Variance|No variance");
  });
});
