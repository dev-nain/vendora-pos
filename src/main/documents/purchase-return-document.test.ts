import { describe, expect, it } from "vitest";
import type { PurchaseReturn } from "../../shared/purchase-returns";
import type { ReceiptSettings } from "../../shared/settings";
import type { PurchaseOrderSupplier } from "./purchase-order-document";
import { buildPurchaseReturnDocument } from "./purchase-return-document";

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

const supplier: PurchaseOrderSupplier = { contactPerson: "Rehman", phone: "0300-1", ntn: null };

function makeReturn(overrides: Partial<PurchaseReturn> = {}): PurchaseReturn {
  return {
    id: "r1",
    returnNo: "PRN-T1-000001",
    supplierId: "s1",
    supplierName: "Rehman Traders",
    goodsReceivedNoteId: "n1",
    grnNo: "GRN-T1-000004",
    supplierInvoiceNo: "INV-1042",
    reason: "damaged",
    notes: "Boxes crushed",
    totalPaisa: 246000 + 2500,
    actorName: "Owner",
    createdAt: "2026-03-05T10:00:00.000Z",
    lines: [
      {
        id: "l1",
        productId: "p1",
        goodsReceivedLineId: "g1",
        nameEn: "Tapal Danedar",
        nameUr: "ٹپال",
        unit: "piece",
        qtyMilli: 6000,
        unitCostPaisa: 41000,
        lineTotalPaisa: 246000,
      },
      {
        id: "l2",
        productId: "p2",
        goodsReceivedLineId: null,
        nameEn: "Sugar",
        nameUr: null,
        unit: "kg",
        qtyMilli: 2500,
        unitCostPaisa: 1000,
        lineTotalPaisa: 2500,
      },
    ],
    ...overrides,
  };
}

const build = (purchaseReturn = makeReturn()) =>
  buildPurchaseReturnDocument({ purchaseReturn, store, supplier });

describe("purchase return document", () => {
  it("has the title, reference and the five columns", () => {
    const model = build();
    expect(model.title).toBe("Purchase return");
    expect(model.reference).toBe("PRN-T1-000001");
    expect(model.columns.map((column) => column.label)).toEqual([
      "#",
      "Product",
      "Quantity",
      "Unit cost",
      "Line total",
    ]);
  });

  it("lists the store and the supplier", () => {
    const model = build();
    expect(model.panels[0]?.lines).toEqual([
      "Noor General Store",
      "Main Bazaar, Lahore",
      "Phone: 042-111",
      "NTN: 1234567-8",
    ]);
    expect(model.panels[1]).toEqual({
      label: "Supplier",
      lines: ["Rehman Traders", "Contact: Rehman", "Phone: 0300-1"],
    });
  });

  it("shows the note and invoice facts only when the return is linked", () => {
    expect(build().facts).toEqual([
      { label: "Date", value: expect.stringMatching(/^\d{2}-\d{2}-2026$/) },
      { label: "Reason", value: "Damaged" },
      { label: "Goods received note", value: "GRN-T1-000004" },
      { label: "Supplier invoice", value: "INV-1042" },
      { label: "Returned by", value: "Owner" },
    ]);
    const unlinked = build(
      makeReturn({ goodsReceivedNoteId: null, grnNo: null, supplierInvoiceNo: null }),
    );
    expect(unlinked.facts.map((fact) => fact.label)).toEqual(["Date", "Reason", "Returned by"]);
  });

  it("builds rows with an Urdu name and totals the lines", () => {
    const model = build();
    expect(model.rows[0]).toEqual([
      { text: "1" },
      { text: "Tapal Danedar", urdu: "ٹپال" },
      { text: "6 pcs" },
      { text: "Rs 410" },
      { text: "Rs 2,460" },
    ]);
    expect(model.rows[1]?.[1]).toEqual({ text: "Sugar" });
    expect(model.totals).toEqual([{ label: "Total", value: "Rs 2,485" }]);
  });

  it("includes notes only when present", () => {
    expect(build().notes).toBe("Boxes crushed");
    expect(build(makeReturn({ notes: null })).notes).toBeNull();
  });
});
