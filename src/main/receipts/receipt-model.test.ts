import { describe, expect, it } from "vitest";
import type { ReceiptBlock } from "../../shared/receipt";
import type { ReceiptSettings } from "../../shared/settings";
import { buildReceiptModel, formatReceiptDateTime } from "./receipt-model";
import type { SaleSnapshot, SnapshotLine } from "./sale-snapshot";

const blankStore: ReceiptSettings = {
  name: null,
  address: null,
  phone: null,
  ntn: null,
  strn: null,
  headerEn: null,
  headerUr: null,
  footerEn: null,
  footerUr: null,
};

const line = (patch: Partial<SnapshotLine> = {}): SnapshotLine => ({
  nameEn: "Tea",
  nameUr: null,
  unit: "piece",
  qtyMilli: 2000,
  packQtyMilli: 1000,
  isReturn: false,
  unitPricePaisa: 11800,
  taxRateBps: 1800,
  grossPaisa: 23600,
  lineDiscountPaisa: 0,
  billDiscountPaisa: 0,
  discountPaisa: 0,
  taxPaisa: 3600,
  totalPaisa: 23600,
  ...patch,
});

const snapshot = (patch: Partial<SaleSnapshot> = {}): SaleSnapshot => ({
  sale: {
    id: "s1",
    invoiceNo: "T1-000231",
    type: "sale",
    refundedInvoiceNo: null,
    createdAt: new Date(2026, 9, 27, 16, 5),
    subtotalPaisa: 23600,
    discountPaisa: 0,
    taxPaisa: 3600,
    roundingPaisa: 0,
    totalPaisa: 23600,
    buyerName: null,
    buyerNtn: null,
    buyerCnic: null,
    buyerPhone: null,
  },
  cashierName: "Ayesha",
  lines: [line()],
  payments: [
    { method: "cash", amountPaisa: 25000, reference: null, isChange: false },
    { method: "cash", amountPaisa: -1400, reference: null, isChange: true },
  ],
  store: blankStore,
  paperWidthMm: 80,
  ...patch,
});

const textOf = (blocks: ReceiptBlock[]): string[] =>
  blocks.flatMap((block) => {
    if (block.type === "text") return [block.text];
    if (block.type === "pair") return [`${block.left}|${block.right}`];
    if (block.type === "table") return block.rows.map((row) => row.join("|"));
    if (block.type === "barcode") return [block.caption];
    return [];
  });

describe("buildReceiptModel", () => {
  it.each([
    [576, 80, 24, 36, 64],
    [384, 58, 20, 28, 56],
  ] as const)("uses the %i px metrics for %i mm paper", (widthPx, _mm, body, title, barHeight) => {
    const model = buildReceiptModel(snapshot(), widthPx);

    expect(model.widthPx).toBe(widthPx);
    expect(model.metrics).toEqual({
      bodyPx: body,
      titlePx: title,
      urduLineHeight: 1.9,
      latinLineHeight: 1.3,
    });
    const barcode = model.blocks.find((block) => block.type === "barcode");
    expect(barcode).toMatchObject({ moduleWidthPx: 2, heightPx: barHeight });
  });

  it("fits the barcode inside 58 mm paper", () => {
    const model = buildReceiptModel(snapshot(), 384);

    const barcode = model.blocks.find((block) => block.type === "barcode");
    expect(
      barcode?.type === "barcode" && barcode.modules.length * barcode.moduleWidthPx,
    ).toBeLessThanOrEqual(384);
  });

  it("prints each header field only when set, in both languages", () => {
    const empty = textOf(buildReceiptModel(snapshot(), 576).blocks);
    expect(empty.slice(0, 1)).toEqual(["Invoice|T1-000231"]);

    const store: ReceiptSettings = {
      name: "Al Noor Store",
      address: "Shop 4, Main Bazaar",
      phone: "0300 1234567",
      ntn: "1234567-8",
      strn: "3277876123419",
      headerEn: "Welcome\nOpen daily",
      headerUr: "خوش آمدید",
      footerEn: "Thank you",
      footerUr: "شکریہ",
    };
    const model = buildReceiptModel(snapshot({ store }), 576);
    const out = textOf(model.blocks);

    expect(out.slice(0, 8)).toEqual([
      "Al Noor Store",
      "Shop 4, Main Bazaar",
      "0300 1234567",
      "NTN 1234567-8",
      "STRN 3277876123419",
      "Welcome",
      "Open daily",
      "خوش آمدید",
    ]);
    expect(out.slice(-2)).toEqual(["Thank you", "شکریہ"]);
    const urdu = model.blocks.filter((block) => block.type === "text" && block.lang === "ur");
    expect(urdu).toHaveLength(2);
    expect(model.blocks[0]).toMatchObject({ size: "title", weight: "bold", align: "center" });
  });

  it("shows invoice, date, cashier and the buyer only when entered", () => {
    const plain = textOf(buildReceiptModel(snapshot(), 576).blocks);
    expect(plain).toContain("Invoice|T1-000231");
    expect(plain).toContain("Date|27-10-2026 4:05 PM");
    expect(plain).toContain("Cashier|Ayesha");
    expect(plain.some((row) => row.startsWith("Buyer"))).toBe(false);

    const sale = { ...snapshot().sale, buyerName: "Bilal Traders", buyerNtn: "7654321-0" };
    const withBuyer = textOf(buildReceiptModel(snapshot({ sale }), 576).blocks);
    expect(withBuyer).toContain("Buyer|Bilal Traders");
    expect(withBuyer).toContain("Buyer NTN|7654321-0");
  });

  it("formats times on a 12 hour clock", () => {
    expect(formatReceiptDateTime(new Date(2026, 0, 5, 0, 7))).toBe("05-01-2026 12:07 AM");
    expect(formatReceiptDateTime(new Date(2026, 0, 5, 12, 0))).toBe("05-01-2026 12:00 PM");
    expect(formatReceiptDateTime(new Date(2026, 11, 31, 23, 59))).toBe("31-12-2026 11:59 PM");
  });

  it("puts the Urdu name on a second line", () => {
    const model = buildReceiptModel(snapshot({ lines: [line({ nameUr: "چائے" })] }), 576);

    const at = model.blocks.findIndex((block) => block.type === "text" && block.text === "Tea");
    expect(model.blocks[at + 1]).toMatchObject({ type: "text", text: "چائے", lang: "ur" });
    expect(model.blocks[at + 2]).toMatchObject({ type: "pair", left: "2 × Rs 118 · 18%" });
  });

  it("shows the line amount and a discount row only when the discount isn't zero", () => {
    const none = textOf(buildReceiptModel(snapshot(), 576).blocks);
    expect(none).toContain("2 × Rs 118 · 18%|Rs 236");
    expect(none).not.toContain("Discount|−Rs 0");
    expect(none.some((row) => row.startsWith("Discount"))).toBe(false);

    const discounted = line({ discountPaisa: 1000, lineDiscountPaisa: 1000, totalPaisa: 22600 });
    const out = textOf(buildReceiptModel(snapshot({ lines: [discounted] }), 576).blocks);
    expect(out).toContain("Discount|−Rs 10");
  });

  it("totals with the bill-totals labels and a rounding row only when needed", () => {
    const base = textOf(buildReceiptModel(snapshot(), 576).blocks);
    expect(base).toContain("Subtotal|Rs 236");
    expect(base).toContain("Sales tax|Rs 36");
    expect(base).toContain("Total|Rs 236");
    expect(base.some((row) => row.startsWith("Rounding"))).toBe(false);

    const sale = { ...snapshot().sale, roundingPaisa: -50, discountPaisa: 500 };
    const lines = [line({ lineDiscountPaisa: 200, billDiscountPaisa: 300, discountPaisa: 500 })];
    const out = textOf(buildReceiptModel(snapshot({ sale, lines }), 576).blocks);
    expect(out).toContain("Rounding|−Rs 0.50");
    expect(out).toContain("Discount|−Rs 2");
    expect(out).toContain("Bill discount|−Rs 3");
  });

  it("summarises tax per rate with exact paisa", () => {
    const lines = [
      line({ taxRateBps: 1800, totalPaisa: 11800, taxPaisa: 1800 }),
      line({ taxRateBps: 0, totalPaisa: 5000, taxPaisa: 0 }),
      line({ taxRateBps: 1800, totalPaisa: 5900, taxPaisa: 900 }),
    ];
    const model = buildReceiptModel(snapshot({ lines }), 576);

    const table = model.blocks.find((block) => block.type === "table");
    expect(table).toEqual({
      type: "table",
      header: ["Rate", "Taxable", "Tax"],
      rows: [
        ["0%", "Rs 50", "Rs 0"],
        ["18%", "Rs 150", "Rs 27"],
      ],
    });
  });

  it("lists payments with references, then change", () => {
    const payments: SaleSnapshot["payments"] = [
      { method: "card", amountPaisa: 10000, reference: "4321", isChange: false },
      { method: "cash", amountPaisa: 15000, reference: null, isChange: false },
      { method: "cash", amountPaisa: -1400, reference: null, isChange: true },
    ];

    const out = textOf(buildReceiptModel(snapshot({ payments }), 576).blocks);

    expect(out).toContain("Card 4321|Rs 100");
    expect(out).toContain("Cash|Rs 150");
    expect(out).toContain("Change|Rs 14");
    expect(out.indexOf("Cash|Rs 150")).toBeLessThan(out.indexOf("Change|Rs 14"));
  });

  it("marks return lines and shows refund amounts with a leading minus", () => {
    const returned = line({
      isReturn: true,
      grossPaisa: -11800,
      totalPaisa: -11800,
      taxPaisa: -1800,
      qtyMilli: -1000,
    });
    const sale = {
      ...snapshot().sale,
      type: "refund" as const,
      totalPaisa: -11800,
      subtotalPaisa: -11800,
      taxPaisa: -1800,
    };
    const payments: SaleSnapshot["payments"] = [
      { method: "cash", amountPaisa: -11800, reference: null, isChange: false },
    ];

    const out = textOf(
      buildReceiptModel(snapshot({ sale, lines: [returned], payments }), 576).blocks,
    );

    expect(out).toContain("Return · −1 × Rs 118 · 18%|−Rs 118");
    expect(out).toContain("Total|−Rs 118");
    expect(out).toContain("Cash|−Rs 118");
  });

  it("titles credit notes and exchanges and shows the original invoice", () => {
    const returned = line({ isReturn: true, qtyMilli: -400, unit: "kg", grossPaisa: -16000 });
    const refund = { ...snapshot().sale, type: "refund" as const, refundedInvoiceNo: "T1-000100" };
    const credit = buildReceiptModel(snapshot({ sale: refund, lines: [returned] }), 576);
    const out = textOf(credit.blocks);

    expect(
      credit.blocks.find((block) => block.type === "text" && block.text === "Credit note"),
    ).toMatchObject({ align: "center", weight: "bold", size: "title" });
    expect(out.indexOf("Credit note")).toBeLessThan(out.indexOf("Invoice|T1-000231"));
    expect(out).toContain("Original invoice|T1-000100");
    expect(out).toContain("Return · −0.400 kg × Rs 118 · 18%|−Rs 160");

    const exchange = textOf(buildReceiptModel(snapshot({ lines: [line(), returned] }), 576).blocks);
    expect(exchange).toContain("Exchange");
    expect(exchange.some((row) => row.startsWith("Original invoice"))).toBe(false);

    const plain = textOf(buildReceiptModel(snapshot(), 576).blocks);
    expect(plain).not.toContain("Credit note");
    expect(plain).not.toContain("Exchange");
  });

  it("prints refunded discounts with their sign", () => {
    const returned = line({
      isReturn: true,
      qtyMilli: -1000,
      grossPaisa: -10000,
      lineDiscountPaisa: -500,
      billDiscountPaisa: -200,
      discountPaisa: -700,
    });
    const sold = line({ lineDiscountPaisa: 300, billDiscountPaisa: 0, discountPaisa: 300 });

    const out = textOf(buildReceiptModel(snapshot({ lines: [sold, returned] }), 576).blocks);

    expect(out).toContain("Discount|−Rs 3");
    expect(out).toContain("Discount|Rs 7");
    expect(out).toContain("Bill discount|Rs 2");
    const refundOnly = textOf(buildReceiptModel(snapshot({ lines: [returned] }), 576).blocks);
    expect(refundOnly).toContain("Discount|Rs 5");
    expect(refundOnly).not.toContain("Discount|−Rs 5");
  });

  it("describes weighed and pack lines", () => {
    const weighed = line({ unit: "kg", qtyMilli: 1250, unitPricePaisa: 40000 });
    const pack = line({ unit: "kg", qtyMilli: 2000, packQtyMilli: 5000, unitPricePaisa: 90000 });

    const out = textOf(buildReceiptModel(snapshot({ lines: [weighed, pack] }), 576).blocks);

    expect(out).toContain("1.250 kg × Rs 400 · 18%|Rs 236");
    expect(out).toContain("2 × Pack (5.000 kg) at Rs 900 · 18%|Rs 236");
  });

  it("ends with a Code 128 of the exact invoice number and never prints MRP, duplicate or Vendora", () => {
    const model = buildReceiptModel(snapshot(), 576);

    const barcode = model.blocks.find((block) => block.type === "barcode");
    expect(barcode).toMatchObject({ type: "barcode", caption: "T1-000231" });
    const all = textOf(model.blocks).join("\n").toLowerCase();
    expect(all).not.toContain("duplicate");
    expect(all).not.toContain("mrp");
    expect(all).not.toContain("vendora");
    expect(all).not.toContain("schedule");
  });

  it("takes the header from the store settings it is given", () => {
    const first = buildReceiptModel(snapshot({ store: { ...blankStore, name: "Old Name" } }), 576);
    const second = buildReceiptModel(snapshot({ store: { ...blankStore, name: "New Name" } }), 576);

    expect(textOf(first.blocks)[0]).toBe("Old Name");
    expect(textOf(second.blocks)[0]).toBe("New Name");
  });
});
