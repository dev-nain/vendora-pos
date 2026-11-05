import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillResult, CompleteSaleResult } from "../../shared/checkout";
import { UnauthenticatedError } from "../auth/errors";
import { billDraftLines, saleLines } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";

const unknownId = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

function okBill(result: BillResult) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill;
}

function okSale(result: CompleteSaleResult) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.sale;
}

describe("returns from a past sale", () => {
  let kit: CheckoutKit;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    kit.openShift(500000);
  });

  afterEach(() => kit.close());

  const linkedDraftLines = () =>
    kit.database.db
      .select()
      .from(billDraftLines)
      .all()
      .filter((row) => row.refundedLineId !== null);
  const exempt = () => kit.taxCategoryId("Exempt");

  function sellOnce(
    items: { barcode: string; times: number }[],
    payments: { method: "cash" | "card"; amountPaisa: number; reference?: string }[],
  ) {
    let draftId = "";
    for (const item of items) {
      for (let i = 0; i < item.times; i += 1) {
        draftId = okBill(kit.billDrafts.scan({ barcode: item.barcode })).id;
      }
    }
    return okSale(kit.sales.complete({ draftId, payments }));
  }

  function setup() {
    const soap = kit.addProduct({
      nameEn: "Soap",
      searchText: "soap",
      salePricePaisa: 15000,
      taxCategoryId: exempt(),
    });
    kit.addBarcode(soap.id, "SOAP");
    const tea = kit.addProduct({
      nameEn: "Tea",
      searchText: "tea",
      salePricePaisa: 42000,
      taxCategoryId: exempt(),
    });
    kit.addBarcode(tea.id, "TEA");
    const sale = sellOnce(
      [
        { barcode: "SOAP", times: 3 },
        { barcode: "TEA", times: 1 },
      ],
      [
        { method: "card", amountPaisa: 30000, reference: "4321" },
        { method: "cash", amountPaisa: 57000 },
      ],
    );
    const lines = kit.database.db.select().from(saleLines).all();
    const line = (name: string) => lines.find((row) => row.nameEn === name)!;
    return { sale, soap: line("Soap"), tea: line("Tea") };
  }

  it("needs a session and an open shift", () => {
    const { sale } = setup();
    kit.sessions.end();
    expect(() => kit.returns.returnable({ saleId: sale.id })).toThrow(UnauthenticatedError);
  });

  it("lists the sellable lines with sold, refunded, pending and left", () => {
    const { sale, soap } = setup();
    expect(kit.returns.returnable({ saleId: unknownId })).toMatchObject({ reason: "not-found" });

    const before = kit.returns.returnable({ saleId: sale.id });
    expect(before).toMatchObject({ ok: true, hasReturnLines: false });
    if (!before.ok) return;
    expect(before.lines).toHaveLength(2);
    expect(before.lines[0]).toMatchObject({
      saleLineId: soap.id,
      soldQtyMilli: 3000,
      refundedQtyMilli: 0,
      pendingQtyMilli: 0,
      leftQtyMilli: 3000,
    });

    okBill(
      kit.returns.addFromSale({
        saleId: sale.id,
        lines: [{ saleLineId: soap.id, qtyMilli: 1000 }],
      }),
    );
    const after = kit.returns.returnable({ saleId: sale.id });
    if (!after.ok) throw new Error("not ok");
    expect(after.lines[0]).toMatchObject({ pendingQtyMilli: 1000, leftQtyMilli: 2000 });
  });

  it("adds negative lines at the original snapshot and merges the same line", () => {
    const { sale, soap } = setup();
    const first = okBill(
      kit.returns.addFromSale({
        saleId: sale.id,
        lines: [{ saleLineId: soap.id, qtyMilli: 1000 }],
      }),
    );
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]).toMatchObject({
      isReturn: true,
      isDamaged: false,
      refundedLineId: soap.id,
      qtyMilli: -1000,
      unitPricePaisa: 15000,
      grossPaisa: -15000,
      totalPaisa: -15000,
    });
    expect(first.refund).toMatchObject({
      saleId: sale.id,
      invoiceNo: sale.invoiceNo,
      linkedRefundPaisa: 15000,
      methods: [{ method: "card", availablePaisa: 30000 }],
    });

    const merged = okBill(
      kit.returns.addFromSale({
        saleId: sale.id,
        lines: [{ saleLineId: soap.id, qtyMilli: 2000 }],
      }),
    );
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0]).toMatchObject({ qtyMilli: -3000, totalPaisa: -45000 });
  });

  it("refuses more than is left, counting what is already on the bill", () => {
    const { sale, soap } = setup();
    okBill(
      kit.returns.addFromSale({
        saleId: sale.id,
        lines: [{ saleLineId: soap.id, qtyMilli: 2000 }],
      }),
    );
    expect(
      kit.returns.addFromSale({
        saleId: sale.id,
        lines: [{ saleLineId: soap.id, qtyMilli: 2000 }],
      }),
    ).toMatchObject({ ok: false, reason: "return-over-sold", message: "Only 1 left to return." });
    expect(linkedDraftLines()).toHaveLength(1);
  });

  it("refuses fractions of a piece and lines of another sale", () => {
    const { sale, soap } = setup();
    expect(
      kit.returns.addFromSale({ saleId: sale.id, lines: [{ saleLineId: soap.id, qtyMilli: 500 }] }),
    ).toMatchObject({ reason: "whole-units" });
    expect(
      kit.returns.addFromSale({
        saleId: unknownId,
        lines: [{ saleLineId: soap.id, qtyMilli: 1000 }],
      }),
    ).toMatchObject({ reason: "not-found" });
    expect(linkedDraftLines()).toHaveLength(0);
  });

  it("refuses a second sale on the same bill", () => {
    const first = setup();
    const second = sellOnce(
      [{ barcode: "SOAP", times: 1 }],
      [{ method: "cash", amountPaisa: 15000 }],
    );
    const secondLine = kit.database.db
      .select()
      .from(saleLines)
      .all()
      .find((row) => row.saleId === second.id)!;
    okBill(
      kit.returns.addFromSale({
        saleId: first.sale.id,
        lines: [{ saleLineId: first.tea.id, qtyMilli: 1000 }],
      }),
    );
    expect(
      kit.returns.addFromSale({
        saleId: second.id,
        lines: [{ saleLineId: secondLine.id, qtyMilli: 1000 }],
      }),
    ).toMatchObject({ ok: false, reason: "one-sale" });
  });

  describe("linked and receipt-less lines on the bill", () => {
    it("locks the price and the discount, and caps the quantity", () => {
      const { sale, soap } = setup();
      const bill = okBill(
        kit.returns.addFromSale({
          saleId: sale.id,
          lines: [{ saleLineId: soap.id, qtyMilli: 1000 }],
        }),
      );
      const lineId = bill.lines[0]!.id;
      expect(kit.billDrafts.updateLine({ lineId, unitPricePaisa: 100 })).toMatchObject({
        reason: "linked-return",
      });
      expect(
        kit.billDrafts.updateLine({ lineId, discount: { kind: "percent", bps: 100 } }),
      ).toMatchObject({ reason: "return-discount" });
      expect(kit.billDrafts.updateLine({ lineId, qtyMilli: 4000 })).toMatchObject({
        reason: "return-over-sold",
        message: "Only 3 left to return.",
      });
      const changed = okBill(kit.billDrafts.updateLine({ lineId, qtyMilli: 2000 }));
      expect(changed.lines[0]).toMatchObject({ qtyMilli: -2000, totalPaisa: -30000 });
    });

    it("flips a receipt-less line both ways and clears its discount", () => {
      setup();
      const added = okBill(kit.billDrafts.scan({ barcode: "SOAP" }));
      const lineId = added.lines[0]!.id;
      okBill(kit.billDrafts.updateLine({ lineId, discount: { kind: "percent", bps: 1000 } }));

      const flipped = okBill(kit.billDrafts.toggleReturn({ lineId }));
      expect(flipped.lines[0]).toMatchObject({
        isReturn: true,
        qtyMilli: -1000,
        refundedLineId: null,
        discount: null,
        totalPaisa: -15000,
      });
      okBill(kit.billDrafts.setDamaged({ lineId, damaged: true }));
      const back = okBill(kit.billDrafts.toggleReturn({ lineId }));
      expect(back.lines[0]).toMatchObject({ isReturn: false, qtyMilli: 1000, isDamaged: false });
    });

    it("refuses to flip a linked line", () => {
      const { sale, soap } = setup();
      const bill = okBill(
        kit.returns.addFromSale({
          saleId: sale.id,
          lines: [{ saleLineId: soap.id, qtyMilli: 1000 }],
        }),
      );
      expect(kit.billDrafts.toggleReturn({ lineId: bill.lines[0]!.id })).toMatchObject({
        reason: "linked-return",
      });
    });

    it("marks only return lines of stocked products as damaged", () => {
      const { sale, soap } = setup();
      const bill = okBill(
        kit.returns.addFromSale({
          saleId: sale.id,
          lines: [{ saleLineId: soap.id, qtyMilli: 1000 }],
        }),
      );
      const sellLine = okBill(kit.billDrafts.scan({ barcode: "TEA" })).lines[1]!;
      const marked = okBill(
        kit.billDrafts.setDamaged({ lineId: bill.lines[0]!.id, damaged: true }),
      );
      expect(marked.lines[0]).toMatchObject({ isDamaged: true });
      expect(kit.billDrafts.setDamaged({ lineId: sellLine.id, damaged: true })).toMatchObject({
        reason: "not-return",
      });
    });

    it("refuses damaged on a misc return", () => {
      kit.setMiscEnabled(true);
      const added = okBill(kit.billDrafts.addMisc({ name: "Loose", pricePaisa: 5000 }));
      const lineId = added.lines[0]!.id;
      okBill(kit.billDrafts.toggleReturn({ lineId }));
      expect(kit.billDrafts.setDamaged({ lineId, damaged: true })).toMatchObject({
        reason: "no-stock",
      });
    });
  });
});
