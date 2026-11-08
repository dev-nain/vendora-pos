import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentModel } from "../../shared/document";
import { postGoodsReceivedInputSchema } from "../../shared/goods-received";
import { postPurchaseReturnInputSchema } from "../../shared/purchase-returns";
import type { ReportExportFormat } from "../../shared/reports";
import { UnauthenticatedError } from "../auth/errors";
import { goodsReceivedLines, goodsReceivedNotes, stores, suppliers } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createGoodsReceivedService } from "./goods-received";
import { createPurchaseReturnsService } from "./purchase-returns";
import { createReportsService } from "./reports";
import { createStockService } from "./stock";

const range = (from: string, to = from) => ({ from, to });

const paisa = (value: number) =>
  `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;

describe("purchases by supplier report", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let goodsReceived: ReturnType<typeof createGoodsReceivedService>;
  let purchaseReturns: ReturnType<typeof createPurchaseReturnsService>;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let chooseSavePath: ReturnType<
    typeof vi.fn<(name: string, format: ReportExportFormat) => Promise<string | null>>
  >;
  let alNoor: string;
  let rehman: string;
  let tea: string;

  const at = (iso: string) => {
    clock = new Date(iso);
  };

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    clock = new Date("2026-11-01T06:00:00.000Z");
    const now = () => clock;
    const stock = createStockService({ database: kit.database, audit: kit.audit, now });
    goodsReceived = createGoodsReceivedService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock,
      now,
    });
    purchaseReturns = createPurchaseReturnsService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock,
      now,
    });
    toPdf = vi.fn(async () => Buffer.from("%PDF-1.4 fake"));
    chooseSavePath = vi.fn(async (name: string) => join(kit.dir, name));
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf, print: vi.fn(async () => "printed" as const) },
      chooseSavePath,
      now,
    });
    const supplier = (name: string) =>
      kit.database.db.insert(suppliers).values({ storeId: kit.storeId, name }).returning().get().id;
    alNoor = supplier("Al-Noor");
    rehman = supplier("rehman Traders");
    tea = kit.addProduct({ nameEn: "Tea", searchText: "tea", costPaisa: 100_000 }).id;
  });

  afterEach(() => kit.close());

  const receive = (supplierId: string, qtyMilli: number, unitCostPaisa: number) => {
    const result = goodsReceived.post(
      postGoodsReceivedInputSchema.parse({
        kind: "direct",
        supplierId,
        supplierInvoiceNo: "INV-1",
        lines: [{ productId: tea, qtyMilli, unitCostPaisa }],
      }),
    );
    if (!result.ok) throw new Error(`receive failed: ${result.reason}`);
    return result.note;
  };

  const giveBack = (supplierId: string, qtyMilli: number) => {
    const result = purchaseReturns.post(
      postPurchaseReturnInputSchema.parse({
        kind: "supplier",
        supplierId,
        reason: "damaged",
        notes: null,
        lines: [{ productId: tea, qtyMilli }],
      }),
    );
    if (!result.ok) throw new Error(`return failed: ${result.reason}`);
    return result.purchaseReturn;
  };

  it("nets purchases of returns", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 10_000, 100_000);
    receive(alNoor, 5_000, 50_000);
    at("2026-11-03T06:00:00.000Z");
    const given = giveBack(alNoor, 1_000);

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      supplier: "Al-Noor",
      receiptCount: 2,
      receivedPaisa: 1_000_000 + 250_000,
      returnCount: 1,
      returnedPaisa: given.totalPaisa,
      netPaisa: 1_250_000 - given.totalPaisa,
    });
    expect(report.totals).toEqual({
      receiptCount: 2,
      receivedPaisa: 1_250_000,
      returnCount: 1,
      returnedPaisa: given.totalPaisa,
      netPaisa: 1_250_000 - given.totalPaisa,
    });
  });

  it("gives a supplier with only a return in range a negative net", () => {
    at("2026-10-20T06:00:00.000Z");
    receive(rehman, 10_000, 100_000);
    at("2026-11-03T06:00:00.000Z");
    const given = giveBack(rehman, 2_000);

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));

    expect(report.rows).toMatchObject([
      { supplier: "rehman Traders", receiptCount: 0, returnCount: 1, receivedPaisa: 0 },
    ]);
    expect(report.rows[0]?.netPaisa).toBe(-given.totalPaisa);
    expect(report.totals.netPaisa).toBe(-given.totalPaisa);
  });

  it("leaves out a return after the range even when its note is inside it", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 10_000, 100_000);
    at("2026-11-09T06:00:00.000Z");
    giveBack(alNoor, 1_000);

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));

    expect(report.rows[0]).toMatchObject({ receiptCount: 1, returnCount: 0, returnedPaisa: 0 });
  });

  it("lists archived suppliers, ordered by name without regard to case", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(rehman, 1_000, 100_000);
    receive(alNoor, 1_000, 100_000);
    kit.database.db
      .update(suppliers)
      .set({ deletedAt: new Date() })
      .where(eq(suppliers.id, alNoor))
      .run();

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));

    expect(report.rows.map((row) => row.supplier)).toEqual(["Al-Noor", "rehman Traders"]);
  });

  it("totals the rows and the notes' headers equal their lines", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 3_000, 33_333);
    receive(rehman, 7_000, 12_345);

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));
    const lineTotal = kit.database.db
      .select()
      .from(goodsReceivedLines)
      .all()
      .reduce((sum, line) => sum + line.lineTotalPaisa, 0);
    const headerTotal = kit.database.db
      .select()
      .from(goodsReceivedNotes)
      .all()
      .reduce((sum, note) => sum + note.totalPaisa, 0);

    expect(report.totals.receivedPaisa).toBe(report.rows.reduce((s, r) => s + r.receivedPaisa, 0));
    expect(report.totals.receivedPaisa).toBe(headerTotal);
    expect(headerTotal).toBe(lineTotal);
    expect(Object.values(report.totals).every(Number.isInteger)).toBe(true);
  });

  it("counts a note on its own Karachi store day", () => {
    at("2026-11-02T18:59:59.000Z");
    receive(alNoor, 1_000, 100_000);
    at("2026-11-02T19:00:00.000Z");
    receive(alNoor, 1_000, 100_000);

    expect(service.purchasesBySupplier(range("2026-11-02")).rows[0]?.receiptCount).toBe(1);
    expect(service.purchasesBySupplier(range("2026-11-03")).rows[0]?.receiptCount).toBe(1);
    expect(service.purchasesBySupplier(range("2026-11-04")).rows).toEqual([]);
  });

  it("leaves out another store's notes", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 1_000, 100_000);
    const other = kit.database.db.insert(stores).values({ name: "Other" }).returning().get();
    kit.database.db.update(goodsReceivedNotes).set({ storeId: other.id }).run();

    expect(service.purchasesBySupplier(range("2026-11-01", "2026-11-07")).rows).toEqual([]);
  });

  it("refuses when signed out", async () => {
    kit.sessions.end();

    expect(() => service.purchasesBySupplier(range("2026-11-01"))).toThrow(UnauthenticatedError);
    await expect(
      service.exportPurchasesBySupplier({ range: range("2026-11-01"), format: "csv" }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("exports the CSV and the PDF", async () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 10_000, 105_050);
    const given = giveBack(alNoor, 2_000);

    await service.exportPurchasesBySupplier({
      range: range("2026-11-01", "2026-11-07"),
      format: "csv",
    });
    await service.exportPurchasesBySupplier({
      range: range("2026-11-01", "2026-11-07"),
      format: "pdf",
    });

    const lines = readFileSync(
      join(kit.dir, "purchases-by-supplier-2026-11-01-to-2026-11-07.csv"),
      "utf8",
    )
      .slice(1)
      .split("\r\n");
    expect(lines[0]).toBe("Supplier,Receipts,Received,Returns,Returned,Net purchases");
    expect(lines[1]).toBe(
      `Al-Noor,1,${paisa(1_050_500)},1,${paisa(given.totalPaisa)},${paisa(1_050_500 - given.totalPaisa)}`,
    );
    expect(toPdf.mock.calls[0]?.[0].reference).toBe("1 Nov 2026 – 7 Nov 2026");
    expect(toPdf.mock.calls[0]?.[0].title).toBe("Purchases by supplier");
  });
});
