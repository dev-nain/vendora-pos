import { describe, expect, it } from "vitest";
import type { ReceiptSettings } from "../../shared/settings";
import type { SaleSnapshot, SnapshotLine } from "../receipts/sale-snapshot";
import { buildSaleInvoiceDocument } from "./sale-invoice-document";

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

const withSale = (patch: Partial<SaleSnapshot["sale"]>, rest: Partial<SaleSnapshot> = {}) => {
  const base = snapshot();
  return snapshot({ sale: { ...base.sale, ...patch }, ...rest });
};

describe("buildSaleInvoiceDocument", () => {
  it("titles a plain sale Invoice with its own number and no original invoice", () => {
    const model = buildSaleInvoiceDocument(snapshot());

    expect(model.title).toBe("Invoice");
    expect(model.reference).toBe("T1-000231");
    expect(model.facts).toEqual([{ label: "Date", value: "27-10-2026 4:05 PM" }]);
  });

  it("titles a refund Credit note and points to the original invoice", () => {
    const model = buildSaleInvoiceDocument(
      withSale({ type: "refund", refundedInvoiceNo: "T1-000100" }),
    );

    expect(model.title).toBe("Credit note");
    expect(model.facts).toContainEqual({ label: "Original invoice", value: "T1-000100" });
  });

  it("leaves out the original invoice for a refund without a receipt", () => {
    const model = buildSaleInvoiceDocument(withSale({ type: "refund" }));

    expect(model.title).toBe("Credit note");
    expect(model.facts.map((fact) => fact.label)).toEqual(["Date"]);
  });

  it("titles a sale with a return line Exchange", () => {
    const model = buildSaleInvoiceDocument(
      snapshot({ lines: [line(), line({ isReturn: true, qtyMilli: -1000 })] }),
    );

    expect(model.title).toBe("Exchange");
  });

  it("shows the store and buyer panels with only the fields that are set", () => {
    const model = buildSaleInvoiceDocument(
      withSale(
        { buyerName: "Bilal Traders", buyerNtn: "1234567-8", buyerCnic: null, buyerPhone: "0300" },
        {
          store: {
            ...blankStore,
            name: "Al Noor",
            address: "Main Bazaar",
            phone: "042-111",
            strn: "S-1",
          },
        },
      ),
    );

    expect(model.panels).toEqual([
      { lines: ["Al Noor", "Main Bazaar", "Phone: 042-111", "STRN: S-1"] },
      { label: "Buyer", lines: ["Bilal Traders", "NTN: 1234567-8", "Phone: 0300"] },
    ]);
  });

  it("leaves out the buyer panel and any empty label when there are no buyer details", () => {
    const model = buildSaleInvoiceDocument(
      withSale({ buyerName: "  " }, { store: { ...blankStore, name: "Al Noor", ntn: "  " } }),
    );

    expect(model.panels).toEqual([{ lines: ["Al Noor"] }]);
    expect(JSON.stringify(model)).not.toMatch(/NTN: ?"|CNIC|Buyer/);
  });

  it("splits the header and footer into English and Urdu lines, dropping blanks", () => {
    const model = buildSaleInvoiceDocument(
      snapshot({
        store: {
          ...blankStore,
          headerEn: "Welcome\n\nOpen daily",
          headerUr: "خوش آمدید",
          footerEn: "Thanks",
          footerUr: "شکریہ",
        },
      }),
    );

    expect(model.header).toEqual([
      { text: "Welcome", lang: "en" },
      { text: "Open daily", lang: "en" },
      { text: "خوش آمدید", lang: "ur" },
    ]);
    expect(model.footer).toEqual([
      { text: "Thanks", lang: "en" },
      { text: "شکریہ", lang: "ur" },
    ]);
  });

  it("builds every line column with the Urdu name, return prefix and signs", () => {
    const model = buildSaleInvoiceDocument(
      snapshot({
        lines: [
          line({ nameUr: "چائے", lineDiscountPaisa: 1000, discountPaisa: 1000 }),
          line({
            nameEn: "Rice",
            unit: "kg",
            qtyMilli: -1500,
            isReturn: true,
            unitPricePaisa: 20000,
            taxRateBps: 0,
            taxPaisa: 0,
            totalPaisa: -30000,
          }),
        ],
      }),
    );

    expect(model.rows[0]).toEqual([
      { text: "1" },
      { text: "Tea", urdu: "چائے" },
      { text: "2" },
      { text: "Rs 118" },
      { text: "Rs 10" },
      { text: "18%" },
      { text: "Rs 36" },
      { text: "Rs 236" },
    ]);
    expect(model.rows[1]).toEqual([
      { text: "2" },
      { text: "Return · Rice" },
      { text: "−1.500 kg" },
      { text: "Rs 200" },
      { text: "Rs 0" },
      { text: "0%" },
      { text: "Rs 0" },
      { text: "−Rs 300" },
    ]);
  });

  it("shows totals with discounts and rounding, and a tax summary by rate", () => {
    const model = buildSaleInvoiceDocument(
      withSale(
        { subtotalPaisa: 50000, taxPaisa: 5000, roundingPaisa: -200, totalPaisa: 44800 },
        {
          lines: [
            line({
              grossPaisa: 30000,
              lineDiscountPaisa: 2000,
              billDiscountPaisa: 1000,
              taxRateBps: 1800,
              taxPaisa: 3000,
              totalPaisa: 27000,
            }),
            line({
              grossPaisa: 20000,
              taxRateBps: 500,
              taxPaisa: 2000,
              totalPaisa: 20000,
            }),
          ],
        },
      ),
    );

    expect(model.totals).toEqual([
      { label: "Subtotal", value: "Rs 500" },
      { label: "Discount", value: "−Rs 20" },
      { label: "Bill discount", value: "−Rs 10" },
      { label: "Sales tax", value: "Rs 50" },
      { label: "Rounding", value: "−Rs 2" },
      { label: "Total", value: "Rs 448" },
    ]);
    expect(model.summaries[0]).toMatchObject({
      label: "Tax summary",
      rows: [
        [{ text: "5%" }, { text: "Rs 180" }, { text: "Rs 20" }],
        [{ text: "18%" }, { text: "Rs 240" }, { text: "Rs 30" }],
      ],
    });
  });

  it("shows payments with references and change", () => {
    const model = buildSaleInvoiceDocument(
      snapshot({
        payments: [
          { method: "card", amountPaisa: 10000, reference: "4321", isChange: false },
          { method: "cash", amountPaisa: 15000, reference: null, isChange: false },
          { method: "cash", amountPaisa: -1400, reference: null, isChange: true },
        ],
      }),
    );

    expect(model.summaries[1]).toMatchObject({
      label: "Payments",
      rows: [
        [{ text: "Card" }, { text: "4321" }, { text: "Rs 100" }],
        [{ text: "Cash" }, { text: "" }, { text: "Rs 150" }],
        [{ text: "Change" }, { text: "" }, { text: "Rs 14" }],
      ],
    });
  });
});
