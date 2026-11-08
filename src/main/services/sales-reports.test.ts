import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bill, BillResult, CompleteSaleResult } from "../../shared/checkout";
import { UnauthenticatedError } from "../auth/errors";
import type { DocumentRenderer } from "../documents/document-window";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReportsService } from "./reports";
import { createSalesService } from "./sales";

const okBill = (result: BillResult): Bill => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill;
};

const okSale = (result: CompleteSaleResult) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.sale;
};

const range = (from: string, to = from) => ({ from, to });

describe("sales reports", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let sellingService: ReturnType<typeof createSalesService>;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    kit.openShift();
    clock = new Date("2026-11-07T10:00:00.000Z");
    sellingService = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: kit.stock,
      now: () => clock,
    });
    const renderer: DocumentRenderer = {
      toPdf: vi.fn(async () => Buffer.from("%PDF-1.4 fake")),
      print: vi.fn(async () => "printed" as const),
    };
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer,
      chooseSavePath: async (name) => join(kit.dir, name),
    });
  });

  afterEach(() => kit.close());

  const product = (name: string, salePricePaisa: number, overrides = {}) =>
    kit.addProduct({
      nameEn: name,
      searchText: name.toLowerCase(),
      salePricePaisa,
      taxCategoryId: kit.taxCategoryId("Exempt"),
      ...overrides,
    });

  function sellAt(at: string, productId: string, qtyMilli = 1000, paid = 1000000) {
    clock = new Date(at);
    const bill = okBill(kit.billDrafts.addProduct({ productId, qtyMilli }));
    return okSale(
      sellingService.complete({
        draftId: bill.id,
        payments: [{ method: "cash", amountPaisa: paid }],
      }),
    );
  }

  describe("by hour", () => {
    it("puts the instants either side of 09:00 Karachi on adjacent hours", () => {
      const tea = product("Tea", 10000);
      sellAt("2026-11-07T03:59:59.999Z", tea.id);
      sellAt("2026-11-07T04:00:00.000Z", tea.id);

      const { rows } = service.salesByHour(range("2026-11-07"));

      expect(rows.find((row) => row.hour === "08:00")?.billCount).toBe(1);
      expect(rows.find((row) => row.hour === "09:00")?.billCount).toBe(1);
    });

    it("sums the same hour across days and always lists 24 ordered rows", () => {
      const tea = product("Tea", 10000);
      sellAt("2026-11-06T04:10:00.000Z", tea.id);
      sellAt("2026-11-07T04:50:00.000Z", tea.id, 2000);

      const { rows, totals } = service.salesByHour(range("2026-11-06", "2026-11-07"));

      expect(rows.map((row) => row.hour)).toEqual(
        Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`),
      );
      expect(rows[9]).toMatchObject({ billCount: 2, grossPaisa: 30000, totalPaisa: 30000 });
      expect(rows[10]).toMatchObject({ billCount: 0, grossPaisa: 0 });
      expect(totals.billCount).toBe(2);
    });

    it("gives no rows for an empty range", () => {
      expect(service.salesByHour(range("2026-11-07")).rows).toEqual([]);
    });

    it("has the same totals as sales by day for the same range", () => {
      const tea = product("Tea", 10000, { taxCategoryId: kit.taxCategoryId("Standard") });
      sellAt("2026-11-06T04:10:00.000Z", tea.id);
      sellAt("2026-11-07T11:50:00.000Z", tea.id, 2000);
      const both = range("2026-11-06", "2026-11-07");

      const hour = service.salesByHour(both).totals;

      expect(hour).toEqual(service.salesByDay(both).totals);
      for (const value of Object.values(hour)) expect(Number.isInteger(value)).toBe(true);
    });

    it("requires a session", () => {
      kit.sessions.end();
      expect(() => service.salesByHour(range("2026-11-07"))).toThrow(UnauthenticatedError);
    });
  });
});
