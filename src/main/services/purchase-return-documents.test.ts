import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentModel } from "../../shared/document";
import { postGoodsReceivedInputSchema } from "../../shared/goods-received";
import { postPurchaseReturnInputSchema } from "../../shared/purchase-returns";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { categories, products, stores, suppliers, taxCategories, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import type { DocumentPrintOutcome, DocumentRenderer } from "../documents/document-window";
import { createAuditService } from "./audit";
import { createGoodsReceivedService } from "./goods-received";
import { createPurchaseReturnDocumentsService } from "./purchase-return-documents";
import { createPurchaseReturnsService } from "./purchase-returns";
import { createStockService } from "./stock";

const pdfBytes = Buffer.from("%PDF-1.4 fake");
const missingId = "01900000-0000-7000-8000-000000000001";

describe("createPurchaseReturnDocumentsService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let returnId: string;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let print: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<DocumentPrintOutcome>>>;
  let chooseSavePath: ReturnType<typeof vi.fn<(name: string) => Promise<string | null>>>;
  let outPath: string;
  let service: ReturnType<typeof createPurchaseReturnDocumentsService>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-prn-docs-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    const storeId = database.db.select().from(stores).get()!.id;
    const user = database.db
      .insert(users)
      .values({ username: "owner", displayName: "Owner", passwordHash: "x", pinHash: "x" })
      .returning()
      .get();
    sessions.start({ userId: user.id, storeId, loggedInAt: new Date() });

    const supplier = database.db
      .insert(suppliers)
      .values({ storeId, name: "Al-Noor", contactPerson: "Usman" })
      .returning()
      .get();
    const product = database.db
      .insert(products)
      .values({
        storeId,
        categoryId: database.db.select().from(categories).get()!.id,
        taxCategoryId: database.db.select().from(taxCategories).get()!.id,
        nameEn: "Sugar",
        unit: "kg",
        costPaisa: 1000,
        salePricePaisa: 1500,
        searchText: "sugar",
      })
      .returning()
      .get();
    const audit = createAuditService(database);
    const stock = createStockService({ database, audit });
    const received = createGoodsReceivedService({ database, audit, sessions, stock });
    received.post(
      postGoodsReceivedInputSchema.parse({
        kind: "direct",
        supplierId: supplier.id,
        supplierInvoiceNo: "INV-1",
        lines: [{ productId: product.id, qtyMilli: 5000, unitCostPaisa: 1000 }],
      }),
    );
    const purchaseReturns = createPurchaseReturnsService({ database, audit, sessions, stock });
    const posted = purchaseReturns.post(
      postPurchaseReturnInputSchema.parse({
        kind: "supplier",
        supplierId: supplier.id,
        reason: "damaged",
        notes: null,
        lines: [{ productId: product.id, qtyMilli: 2500 }],
      }),
    );
    if (!posted.ok) throw new Error(posted.message);
    returnId = posted.purchaseReturn.id;

    outPath = join(dir, "out.pdf");
    toPdf = vi.fn(async () => pdfBytes);
    print = vi.fn(async () => "printed" as const);
    chooseSavePath = vi.fn(async () => outPath);
    const renderer: DocumentRenderer = { toPdf, print };
    service = createPurchaseReturnDocumentsService({
      database,
      sessions,
      purchaseReturns,
      renderer,
      chooseSavePath,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("savePdf", () => {
    it("writes the bytes to the chosen path and leaves no temporary file", async () => {
      expect(await service.savePdf({ id: returnId })).toEqual({
        ok: true,
        status: "saved",
        path: outPath,
      });
      expect(readFileSync(outPath)).toEqual(pdfBytes);
      expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });

    it("proposes the return number as the file name and renders that return", async () => {
      await service.savePdf({ id: returnId });
      expect(chooseSavePath).toHaveBeenCalledWith("PRN-T1-000001.pdf");
      expect(toPdf.mock.calls[0]?.[0]).toMatchObject({ reference: "PRN-T1-000001" });
    });

    it("writes nothing when the dialog is cancelled", async () => {
      chooseSavePath.mockResolvedValue(null);
      expect(await service.savePdf({ id: returnId })).toEqual({ ok: true, status: "cancelled" });
      expect(toPdf).not.toHaveBeenCalled();
      expect(existsSync(outPath)).toBe(false);
    });

    it("refuses an unknown return before the dialog", async () => {
      expect(await service.savePdf({ id: missingId })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      expect(chooseSavePath).not.toHaveBeenCalled();
    });

    it("returns failed when rendering fails", async () => {
      toPdf.mockRejectedValue(new Error("boom"));
      expect(await service.savePdf({ id: returnId })).toMatchObject({
        ok: false,
        reason: "failed",
      });
      expect(existsSync(outPath)).toBe(false);
    });

    it("returns failed when the write fails, keeps the old file and removes the temp file", async () => {
      writeFileSync(outPath, "old");
      mkdirSync(`${outPath}.tmp`);
      expect(await service.savePdf({ id: returnId })).toMatchObject({
        ok: false,
        reason: "failed",
      });
      expect(readFileSync(outPath, "utf8")).toBe("old");
    });

    it("throws when signed out, before the dialog", async () => {
      sessions.end();
      await expect(service.savePdf({ id: returnId })).rejects.toBeInstanceOf(UnauthenticatedError);
      expect(chooseSavePath).not.toHaveBeenCalled();
    });
  });

  describe("print", () => {
    it.each([
      ["printed", { ok: true, status: "printed" }],
      ["cancelled", { ok: true, status: "cancelled" }],
      ["failed", { ok: false, reason: "failed" }],
    ] as const)("maps %s", async (outcome, expected) => {
      print.mockResolvedValue(outcome);
      expect(await service.print({ id: returnId })).toMatchObject(expected);
    });

    it("returns failed when the renderer throws", async () => {
      print.mockRejectedValue(new Error("boom"));
      expect(await service.print({ id: returnId })).toMatchObject({
        ok: false,
        reason: "failed",
      });
    });

    it("refuses an unknown return", async () => {
      expect(await service.print({ id: missingId })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      expect(print).not.toHaveBeenCalled();
    });

    it("throws when signed out", async () => {
      sessions.end();
      await expect(service.print({ id: returnId })).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });
});
