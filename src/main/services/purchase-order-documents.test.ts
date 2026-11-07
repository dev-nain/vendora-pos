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
import { createPurchaseOrderInputSchema } from "../../shared/purchase-orders";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { categories, products, stores, suppliers, taxCategories, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import type { DocumentModel } from "../../shared/document";
import type { DocumentPrintOutcome, DocumentRenderer } from "../documents/document-window";
import { createAuditService } from "./audit";
import { createPurchaseOrderDocumentsService } from "./purchase-order-documents";
import { createPurchaseOrdersService } from "./purchase-orders";

const pdfBytes = Buffer.from("%PDF-1.4 fake");

describe("createPurchaseOrderDocumentsService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let storeId: string;
  let orderId: string;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let print: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<DocumentPrintOutcome>>>;
  let chooseSavePath: ReturnType<typeof vi.fn<(name: string) => Promise<string | null>>>;
  let outPath: string;
  let service: ReturnType<typeof createPurchaseOrderDocumentsService>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-po-docs-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    storeId = database.db.select().from(stores).get()!.id;

    const user = database.db
      .insert(users)
      .values({
        username: "owner",
        displayName: "Owner",
        passwordHash: "x",
        pinHash: "x",
      })
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
    const purchaseOrders = createPurchaseOrdersService({
      database,
      audit: createAuditService(database),
      sessions,
    });
    const created = purchaseOrders.create(
      createPurchaseOrderInputSchema.parse({
        supplierId: supplier.id,
        notes: null,
        lines: [{ productId: product.id, orderedQtyMilli: 2500, unitCostPaisa: 1000 }],
      }),
    );
    if (!created.ok) throw new Error(created.message);
    orderId = created.order.id;

    outPath = join(dir, "out.pdf");
    toPdf = vi.fn(async () => pdfBytes);
    print = vi.fn(async () => "printed" as const);
    chooseSavePath = vi.fn(async () => outPath);
    const renderer: DocumentRenderer = { toPdf, print };
    service = createPurchaseOrderDocumentsService({
      database,
      sessions,
      purchaseOrders,
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
      expect(await service.savePdf({ id: orderId })).toEqual({
        ok: true,
        status: "saved",
        path: outPath,
      });
      expect(readFileSync(outPath)).toEqual(pdfBytes);
      expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });

    it("proposes the order number as the file name and renders that order", async () => {
      await service.savePdf({ id: orderId });
      expect(chooseSavePath).toHaveBeenCalledWith("PO-T1-000001.pdf");
      expect(toPdf.mock.calls[0]?.[0]).toMatchObject({ reference: "PO-T1-000001" });
    });

    it("writes nothing when the dialog is cancelled", async () => {
      chooseSavePath.mockResolvedValue(null);
      expect(await service.savePdf({ id: orderId })).toEqual({ ok: true, status: "cancelled" });
      expect(toPdf).not.toHaveBeenCalled();
      expect(existsSync(outPath)).toBe(false);
    });

    it("refuses an unknown order before the dialog", async () => {
      const result = await service.savePdf({ id: "01900000-0000-7000-8000-000000000001" });
      expect(result).toMatchObject({ ok: false, reason: "not-found" });
      expect(chooseSavePath).not.toHaveBeenCalled();
    });

    it("returns failed when rendering fails", async () => {
      toPdf.mockRejectedValue(new Error("boom"));
      expect(await service.savePdf({ id: orderId })).toMatchObject({
        ok: false,
        reason: "failed",
      });
      expect(existsSync(outPath)).toBe(false);
    });

    it("returns failed when the write fails and keeps an existing file", async () => {
      writeFileSync(outPath, "old");
      mkdirSync(`${outPath}.tmp`);
      expect(await service.savePdf({ id: orderId })).toMatchObject({
        ok: false,
        reason: "failed",
      });
      expect(readFileSync(outPath, "utf8")).toBe("old");
    });

    it("throws when signed out, before the dialog", async () => {
      sessions.end();
      await expect(service.savePdf({ id: orderId })).rejects.toBeInstanceOf(UnauthenticatedError);
      expect(chooseSavePath).not.toHaveBeenCalled();
    });

    it("throws when the session ends during the dialog", async () => {
      chooseSavePath.mockImplementation(async () => {
        sessions.end();
        return outPath;
      });
      await expect(service.savePdf({ id: orderId })).rejects.toBeInstanceOf(UnauthenticatedError);
      expect(existsSync(outPath)).toBe(false);
    });
  });

  describe("print", () => {
    it.each([
      ["printed", { ok: true, status: "printed" }],
      ["cancelled", { ok: true, status: "cancelled" }],
      ["failed", { ok: false, reason: "failed" }],
    ] as const)("maps %s", async (outcome, expected) => {
      print.mockResolvedValue(outcome);
      expect(await service.print({ id: orderId })).toMatchObject(expected);
    });

    it("returns failed when the renderer throws", async () => {
      print.mockRejectedValue(new Error("boom"));
      expect(await service.print({ id: orderId })).toMatchObject({ ok: false, reason: "failed" });
    });

    it("refuses an unknown order", async () => {
      const result = await service.print({ id: "01900000-0000-7000-8000-000000000001" });
      expect(result).toMatchObject({ ok: false, reason: "not-found" });
      expect(print).not.toHaveBeenCalled();
    });

    it("throws when signed out", async () => {
      sessions.end();
      await expect(service.print({ id: orderId })).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });
});
