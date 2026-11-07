import { describe, expect, it } from "vitest";
import type { PurchaseOrder } from "../../shared/purchase-orders";
import type { ReceiptSettings } from "../../shared/settings";
import { buildPurchaseOrderDocument, type PurchaseOrderSupplier } from "./purchase-order-document";

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
  address: null,
  phone: null,
  ntn: null,
  strn: null,
  headerEn: null,
  headerUr: null,
  footerEn: null,
  footerUr: null,
};

const supplier: PurchaseOrderSupplier = { contactPerson: "Rehman", phone: "0300-1", ntn: null };

function makeOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: "o1",
    orderNo: "PO-T1-000001",
    supplierId: "s1",
    supplierName: "Rehman Traders",
    status: "draft",
    totalPaisa: 984000 + 2500,
    lineCount: 2,
    createdAt: "2026-03-05T10:00:00.000Z",
    notes: "Deliver Friday",
    createdByName: "Owner",
    lines: [
      {
        id: "l1",
        productId: "p1",
        nameEn: "Tapal Danedar",
        nameUr: "ٹپال",
        unit: "piece",
        orderedQtyMilli: 24000,
        unitCostPaisa: 41000,
        lineTotalPaisa: 984000,
        receivedQtyMilli: 0,
        remainingQtyMilli: 24000,
      },
      {
        id: "l2",
        productId: "p2",
        nameEn: "Sugar",
        nameUr: null,
        unit: "kg",
        orderedQtyMilli: 2500,
        unitCostPaisa: 1000,
        lineTotalPaisa: 2500,
        receivedQtyMilli: 0,
        remainingQtyMilli: 2500,
      },
    ],
    ...overrides,
  };
}

const build = (order = makeOrder(), settings = store, supplierFields = supplier) =>
  buildPurchaseOrderDocument({ order, store: settings, supplier: supplierFields });

describe("purchase order document", () => {
  it("has exactly the five columns", () => {
    expect(build().columns.map((column) => column.label)).toEqual([
      "#",
      "Product",
      "Quantity",
      "Unit cost",
      "Line total",
    ]);
  });

  it("never mentions tax and totals the lines", () => {
    const model = build();
    expect(JSON.stringify(model).toLowerCase()).not.toContain("tax");
    expect(model.totals).toEqual([{ label: "Total", value: "Rs 9,865" }]);
  });

  it("builds rows with quantity text per unit and an Urdu name", () => {
    const [first, second] = build().rows;
    expect(first).toEqual([
      { text: "1" },
      { text: "Tapal Danedar", urdu: "ٹپال" },
      { text: "24 pcs" },
      { text: "Rs 410" },
      { text: "Rs 9,840" },
    ]);
    expect(second?.[1]).toEqual({ text: "Sugar" });
    expect(second?.[2]).toEqual({ text: "2.500 kg" });
  });

  it("shows the order number, title, status and date", () => {
    const model = build(makeOrder({ status: "partly_received" }));
    expect(model.title).toBe("Purchase order");
    expect(model.reference).toBe("PO-T1-000001");
    expect(model.facts).toEqual([
      { label: "Date", value: expect.stringMatching(/^\d{2}-\d{2}-2026$/) },
      { label: "Status", value: "Partly received" },
      { label: "Prepared by", value: "Owner" },
    ]);
  });

  it("lists the store and supplier details without receipt header or footer", () => {
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
    expect(JSON.stringify(model)).not.toContain("Welcome");
    expect(JSON.stringify(model)).not.toContain("Thanks");
  });

  it("omits empty store and supplier fields", () => {
    const model = build(makeOrder(), emptyStore, { contactPerson: null, phone: " ", ntn: null });
    expect(model.panels).toEqual([{ label: "Supplier", lines: ["Rehman Traders"] }]);
  });

  it("includes notes only when present", () => {
    expect(build().notes).toBe("Deliver Friday");
    expect(build(makeOrder({ notes: null })).notes).toBeNull();
  });
});
