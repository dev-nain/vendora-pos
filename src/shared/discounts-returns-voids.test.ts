import { describe, expect, it } from "vitest";
import {
  discountsReturnsVoidsResultSchema,
  discountsReturnsVoidsSections,
  sectionNote,
  type DiscountsReturnsVoidsResult,
} from "./discounts-returns-voids";
import { formatReportCell } from "./reports";

const sampleResult: DiscountsReturnsVoidsResult = {
  discounts: {
    byUser: [{ userId: "u1", userName: "Ayesha", billCount: 2, discountPaisa: 1500 }],
    bills: [
      {
        saleId: "s1",
        invoiceNo: "T1-000002",
        createdAt: "2026-11-07T10:04:00.000Z",
        userName: "Ayesha",
        totalPaisa: 9500,
        discountPaisa: 500,
      },
    ],
    billCount: 2,
    discountPaisa: 1500,
  },
  returns: {
    summary: [
      { kind: "with-receipt", label: "With receipt", lineCount: 1, valuePaisa: 9500 },
      { kind: "without-receipt", label: "Without receipt", lineCount: 2, valuePaisa: 8000 },
      { kind: "back-to-shelf", label: "Back to shelf", lineCount: 1, valuePaisa: 5000 },
      { kind: "damaged", label: "Damaged", lineCount: 1, valuePaisa: 9500 },
    ],
    lines: [
      {
        lineId: "l1",
        saleId: "s2",
        invoiceNo: "T1-000005",
        createdAt: "2026-11-07T10:05:00.000Z",
        userName: "Ayesha",
        itemName: "Loose sugar",
        unit: "piece",
        qtyMilli: -1000,
        receiptInvoiceNo: null,
        disposition: "no-stock",
        valuePaisa: 3000,
      },
      {
        lineId: "l2",
        saleId: "s3",
        invoiceNo: "T1-000004",
        createdAt: "2026-11-07T10:06:00.000Z",
        userName: "Ayesha",
        itemName: "Tea",
        unit: "kg",
        qtyMilli: -1500,
        receiptInvoiceNo: "T1-000001",
        disposition: "damaged",
        valuePaisa: 9500,
      },
    ],
    lineCount: 4,
    valuePaisa: 17500,
  },
  voids: {
    deletedLines: {
      rows: (["sold", "discarded", "not-completed"] as const).map((billState, index) => ({
        auditId: `a${index}`,
        createdAt: "2026-11-07T10:07:00.000Z",
        userName: "Ayesha",
        itemName: "Soap",
        unit: "piece" as const,
        qtyMilli: 1000,
        billState,
        invoiceNo: billState === "sold" ? "T1-000002" : null,
        grossPaisa: 5000,
      })),
      count: 3,
      grossPaisa: 15000,
    },
    discardedBills: {
      rows: [
        {
          auditId: "d1",
          createdAt: "2026-11-07T10:08:00.000Z",
          userName: "Ayesha",
          lineCount: 2,
          totalPaisa: 10000,
        },
      ],
      count: 1,
      totalPaisa: 10000,
    },
  },
};

const sections = discountsReturnsVoidsSections(sampleResult);
const section = (id: string) => sections.find((candidate) => candidate.id === id)!;
const textOf = (id: string, key: string) => section(id).rows.map((row) => row[key]);

describe("discountsReturnsVoidsSections", () => {
  it("builds the six tables in order with their headings", () => {
    expect(
      sections.map((candidate) => [candidate.title, candidate.columns.map((c) => c.label)]),
    ).toEqual([
      ["Discounts by user", ["User", "Bills", "Discount"]],
      ["Discounted bills", ["Invoice", "Time", "User", "Bill total", "Discount"]],
      ["Returns summary", ["Return", "Lines", "Value"]],
      ["Returned lines", ["Invoice", "Time", "User", "Item", "Qty", "Receipt", "Stock", "Value"]],
      ["Deleted lines", ["Time", "User", "Item", "Qty", "Bill", "Gross before discount"]],
      ["Discarded bills", ["Time", "User", "Lines", "Bill total"]],
    ]);
  });

  it("words the receipt and stock cells", () => {
    expect(textOf("returned-lines", "receipt")).toEqual(["Without receipt", "T1-000001"]);
    expect(textOf("returned-lines", "stock")).toEqual(["No stock", "Damaged"]);
  });

  it("says why a deleted line has no bill", () => {
    expect(textOf("deleted-lines", "bill")).toEqual(["T1-000002", "Discarded", "Not completed"]);
    expect(textOf("deleted-lines", "invoiceNo")).toEqual(["T1-000002", "", ""]);
  });

  it("formats the quantity with the row's unit", () => {
    const qty = section("returned-lines").columns.find((column) => column.key === "qtyMilli")!;
    const [first, second] = section("returned-lines").rows;
    expect(formatReportCell(qty, first!.qtyMilli!, first)).toBe("−1 pcs");
    expect(formatReportCell(qty, second!.qtyMilli!, second)).toBe("−1.500 kg");
  });

  it("totals only the tables that have a total", () => {
    expect(sections.map((candidate) => candidate.totals)).toEqual([
      { billCount: 2, discountPaisa: 1500 },
      null,
      null,
      null,
      { grossPaisa: 15000 },
      { totalPaisa: 10000 },
    ]);
  });
});

describe("sectionNote", () => {
  it("states the cut only when rows are missing", () => {
    expect(sectionNote({ shown: 200, total: 340 })).toBe(
      "Showing the latest 200 of 340. The CSV export has every row.",
    );
    expect(sectionNote({ shown: 3, total: 3 })).toBeNull();
  });
});

describe("discountsReturnsVoidsResultSchema", () => {
  it("accepts the result and rejects extra keys", () => {
    expect(discountsReturnsVoidsResultSchema.safeParse(sampleResult).success).toBe(true);
    expect(discountsReturnsVoidsResultSchema.safeParse({ ...sampleResult, extra: 1 }).success).toBe(
      false,
    );
  });
});
