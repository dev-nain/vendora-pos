import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { z } from "zod";
import {
  productMessages,
  type BarcodeLookup,
  type BarcodeLookupInput,
  type CreateProductResult,
  type DeleteProductResult,
  type GetProductResult,
  type createProductInputSchema,
  type Product,
  type ProductIdInput,
  type ProductSearchInput,
  type ProductSearchResult,
  type ProductStatusResult,
  type UpdateProductResult,
  type updateProductInputSchema,
} from "../../shared/products";
import { requireSessionPermission, requireUnlockedSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { categories, productBarcodes, products, taxCategories } from "../db/schema";
import type { createAuditService } from "./audit";
import { lookupBarcode } from "./barcode-lookup";
import { searchProducts } from "./product-search";
import { normalizeSearchText } from "./search-text";

type CreateInput = z.output<typeof createProductInputSchema>;
type UpdateInput = z.output<typeof updateProductInputSchema>;
type Tx = Parameters<Parameters<VendoraDatabase["db"]["transaction"]>[0]>[0];
type ProductRow = typeof products.$inferSelect;
type BarcodeRow = typeof productBarcodes.$inferSelect;
type Refusal = Extract<UpdateProductResult, { ok: false }>;
type StatusRefusal = Extract<ProductStatusResult, { ok: false }>;
type CreateRefusal = Extract<CreateProductResult, { ok: false }>;

interface ProductsDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  now?: () => Date;
}

const refuse = <R extends (Refusal | StatusRefusal)["reason"]>(reason: R, message: string) =>
  ({ ok: false, reason, message }) as Extract<Refusal | StatusRefusal, { reason: R }>;

function activeBarcodes(tx: Tx, productId: string): BarcodeRow[] {
  return tx
    .select()
    .from(productBarcodes)
    .where(and(eq(productBarcodes.productId, productId), isNull(productBarcodes.deletedAt)))
    .orderBy(asc(productBarcodes.barcode))
    .all();
}

function findProduct(tx: Tx, storeId: string, id: string): ProductRow | undefined {
  return tx
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.storeId, storeId), isNull(products.deletedAt)))
    .get();
}

function toProduct(row: ProductRow, barcodes: BarcodeRow[]): Product {
  return {
    id: row.id,
    nameEn: row.nameEn,
    nameUr: row.nameUr,
    categoryId: row.categoryId,
    taxCategoryId: row.taxCategoryId,
    brand: row.brand,
    unit: row.unit,
    internalCode: row.internalCode,
    costPaisa: row.costPaisa,
    salePricePaisa: row.salePricePaisa,
    mrpPaisa: row.mrpPaisa,
    pctCode: row.pctCode,
    lowStockThresholdMilli: row.lowStockThresholdMilli,
    isActive: row.isActive,
    barcodes: barcodes.map((b) => ({
      barcode: b.barcode,
      packQtyMilli: b.packQtyMilli,
      salePricePaisa: b.salePricePaisa,
    })),
  };
}

export function getProduct(database: VendoraDatabase, storeId: string, id: string): Product | null {
  return database.db.transaction((tx) => {
    const row = findProduct(tx, storeId, id);
    if (!row || row.isSystem) return null;
    return toProduct(row, activeBarcodes(tx, row.id));
  });
}

function checkReferences(tx: Tx, storeId: string, input: CreateInput): CreateRefusal | null {
  const category = tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, input.categoryId),
        eq(categories.storeId, storeId),
        isNull(categories.deletedAt),
      ),
    )
    .get();
  if (!category) return refuse("category-not-found", productMessages.categoryNotFound);

  const taxCategory = tx
    .select({ id: taxCategories.id })
    .from(taxCategories)
    .where(
      and(
        eq(taxCategories.id, input.taxCategoryId),
        eq(taxCategories.storeId, storeId),
        isNull(taxCategories.deletedAt),
      ),
    )
    .get();
  if (!taxCategory) return refuse("tax-category-not-found", productMessages.taxCategoryNotFound);
  return null;
}

// Mirrors the partial unique indexes: any non-deleted row blocks reuse, archived products included.
function checkClashes(
  tx: Tx,
  storeId: string,
  input: CreateInput,
  excludeProductId: string | null,
): CreateRefusal | null {
  if (input.internalCode !== null) {
    const clash = tx
      .select({ nameEn: products.nameEn })
      .from(products)
      .where(
        and(
          eq(products.storeId, storeId),
          eq(products.internalCode, input.internalCode),
          isNull(products.deletedAt),
          excludeProductId ? ne(products.id, excludeProductId) : undefined,
        ),
      )
      .get();
    if (clash) {
      return refuse(
        "internal-code-taken",
        productMessages.internalCodeTaken(input.internalCode, clash.nameEn),
      );
    }
  }

  if (input.barcodes.length > 0) {
    const clash = tx
      .select({ barcode: productBarcodes.barcode, nameEn: products.nameEn })
      .from(productBarcodes)
      .innerJoin(products, eq(products.id, productBarcodes.productId))
      .where(
        and(
          eq(productBarcodes.storeId, storeId),
          inArray(
            productBarcodes.barcode,
            input.barcodes.map((b) => b.barcode),
          ),
          isNull(productBarcodes.deletedAt),
          excludeProductId ? ne(productBarcodes.productId, excludeProductId) : undefined,
        ),
      )
      .get();
    if (clash) {
      return refuse("barcode-taken", productMessages.barcodeTaken(clash.barcode, clash.nameEn));
    }
  }
  return null;
}

export function createProductsService({
  database,
  audit,
  sessions,
  now = () => new Date(),
}: ProductsDeps) {
  const { db } = database;

  const setActive = (input: ProductIdInput, isActive: boolean): ProductStatusResult => {
    const session = requireSessionPermission(sessions, "products.manage");

    return db.transaction((tx) => {
      const current = findProduct(tx, session.storeId, input.id);
      if (!current) return refuse("not-found", productMessages.notFound);
      if (!isActive && current.isSystem) {
        return refuse("system-product", productMessages.systemProduct);
      }
      if (current.isActive === isActive) {
        return { ok: true, product: toProduct(current, activeBarcodes(tx, current.id)) };
      }

      const row = tx
        .update(products)
        .set({ isActive, updatedAt: now() })
        .where(eq(products.id, current.id))
        .returning()
        .get();
      audit.record(
        {
          actorUserId: session.userId,
          action: isActive ? "product_restore" : "product_archive",
          entityType: "product",
          entityId: current.id,
          details: { nameEn: current.nameEn },
        },
        tx,
      );
      return { ok: true, product: toProduct(row, activeBarcodes(tx, row.id)) };
    });
  };

  return {
    search(input: ProductSearchInput): ProductSearchResult {
      const session = requireUnlockedSession(sessions);
      return searchProducts(database, session.storeId, input);
    },

    get(input: ProductIdInput): GetProductResult {
      const session = requireUnlockedSession(sessions);
      const product = getProduct(database, session.storeId, input.id);
      if (!product) return refuse("not-found", productMessages.notFound);
      return { ok: true, product };
    },

    lookupBarcode(input: BarcodeLookupInput): BarcodeLookup | null {
      const session = requireUnlockedSession(sessions);
      return lookupBarcode(database, session.storeId, input.barcode);
    },

    archive: (input: ProductIdInput): ProductStatusResult => setActive(input, false),

    restore: (input: ProductIdInput): ProductStatusResult => setActive(input, true),

    delete(input: ProductIdInput): DeleteProductResult {
      const session = requireSessionPermission(sessions, "products.manage");

      return db.transaction((tx) => {
        const current = findProduct(tx, session.storeId, input.id);
        if (!current) return refuse("not-found", productMessages.notFound);
        if (current.isSystem) return refuse("system-product", productMessages.systemProduct);

        const barcodes = activeBarcodes(tx, current.id);
        const deletedAt = now();
        for (const barcode of barcodes) {
          tx.update(productBarcodes)
            .set({ deletedAt, updatedAt: deletedAt })
            .where(eq(productBarcodes.id, barcode.id))
            .run();
        }
        tx.update(products)
          .set({ deletedAt, updatedAt: deletedAt })
          .where(eq(products.id, current.id))
          .run();
        audit.record(
          {
            actorUserId: session.userId,
            action: "product_delete",
            entityType: "product",
            entityId: current.id,
            details: { nameEn: current.nameEn, barcodes: barcodes.map((b) => b.barcode) },
          },
          tx,
        );
        return { ok: true };
      });
    },

    create(input: CreateInput): CreateProductResult {
      const session = requireSessionPermission(sessions, "products.manage");

      return db.transaction((tx) => {
        const refusal =
          checkReferences(tx, session.storeId, input) ??
          checkClashes(tx, session.storeId, input, null);
        if (refusal) return refusal;

        const row = tx
          .insert(products)
          .values({
            storeId: session.storeId,
            nameEn: input.nameEn,
            nameUr: input.nameUr,
            searchText: normalizeSearchText(input.nameEn, input.nameUr, input.internalCode),
            categoryId: input.categoryId,
            taxCategoryId: input.taxCategoryId,
            brand: input.brand,
            unit: input.unit,
            internalCode: input.internalCode,
            costPaisa: input.costPaisa,
            salePricePaisa: input.salePricePaisa,
            mrpPaisa: input.mrpPaisa,
            pctCode: input.pctCode,
            lowStockThresholdMilli: input.lowStockThresholdMilli,
            createdAt: now(),
            updatedAt: now(),
          })
          .returning()
          .get();

        if (input.barcodes.length > 0) {
          tx.insert(productBarcodes)
            .values(
              input.barcodes.map((b) => ({
                storeId: session.storeId,
                productId: row.id,
                barcode: b.barcode,
                packQtyMilli: b.packQtyMilli,
                salePricePaisa: b.salePricePaisa,
                createdAt: now(),
                updatedAt: now(),
              })),
            )
            .run();
        }

        return { ok: true, product: toProduct(row, activeBarcodes(tx, row.id)) };
      });
    },

    update(input: UpdateInput): UpdateProductResult {
      const session = requireSessionPermission(sessions, "products.manage");

      return db.transaction((tx) => {
        const current = tx
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, input.id),
              eq(products.storeId, session.storeId),
              isNull(products.deletedAt),
            ),
          )
          .get();
        if (!current) return refuse("not-found", productMessages.notFound);

        const refusal =
          checkReferences(tx, session.storeId, input) ??
          checkClashes(tx, session.storeId, input, current.id);
        if (refusal) return refusal;

        const row = tx
          .update(products)
          .set({
            nameEn: input.nameEn,
            nameUr: input.nameUr,
            searchText: normalizeSearchText(input.nameEn, input.nameUr, input.internalCode),
            categoryId: input.categoryId,
            taxCategoryId: input.taxCategoryId,
            brand: input.brand,
            unit: input.unit,
            internalCode: input.internalCode,
            costPaisa: input.costPaisa,
            salePricePaisa: input.salePricePaisa,
            mrpPaisa: input.mrpPaisa,
            pctCode: input.pctCode,
            lowStockThresholdMilli: input.lowStockThresholdMilli,
            updatedAt: now(),
          })
          .where(eq(products.id, current.id))
          .returning()
          .get();

        const existing = new Map(activeBarcodes(tx, current.id).map((b) => [b.barcode, b]));
        const wanted = new Set(input.barcodes.map((b) => b.barcode));
        const priceChanges: {
          barcode: string;
          oldPaisa: number | null;
          newPaisa: number | null;
        }[] = [];

        for (const old of existing.values()) {
          if (wanted.has(old.barcode)) continue;
          tx.update(productBarcodes)
            .set({ deletedAt: now(), updatedAt: now() })
            .where(eq(productBarcodes.id, old.id))
            .run();
        }

        for (const next of input.barcodes) {
          const old = existing.get(next.barcode);
          if (!old) {
            tx.insert(productBarcodes)
              .values({
                storeId: session.storeId,
                productId: current.id,
                barcode: next.barcode,
                packQtyMilli: next.packQtyMilli,
                salePricePaisa: next.salePricePaisa,
                createdAt: now(),
                updatedAt: now(),
              })
              .run();
            continue;
          }
          if (
            old.packQtyMilli === next.packQtyMilli &&
            old.salePricePaisa === next.salePricePaisa
          ) {
            continue;
          }
          tx.update(productBarcodes)
            .set({
              packQtyMilli: next.packQtyMilli,
              salePricePaisa: next.salePricePaisa,
              updatedAt: now(),
            })
            .where(eq(productBarcodes.id, old.id))
            .run();
          if (old.salePricePaisa !== next.salePricePaisa) {
            priceChanges.push({
              barcode: next.barcode,
              oldPaisa: old.salePricePaisa,
              newPaisa: next.salePricePaisa,
            });
          }
        }

        const auditBase = {
          actorUserId: session.userId,
          entityType: "product",
          entityId: current.id,
        } as const;
        if (current.salePricePaisa !== input.salePricePaisa) {
          audit.record(
            {
              ...auditBase,
              action: "price_change",
              details: { oldPaisa: current.salePricePaisa, newPaisa: input.salePricePaisa },
            },
            tx,
          );
        }
        if (current.costPaisa !== input.costPaisa) {
          audit.record(
            {
              ...auditBase,
              action: "cost_change",
              details: { oldPaisa: current.costPaisa, newPaisa: input.costPaisa },
            },
            tx,
          );
        }
        for (const change of priceChanges.toSorted((a, b) => a.barcode.localeCompare(b.barcode))) {
          audit.record({ ...auditBase, action: "price_change", details: change }, tx);
        }

        return { ok: true, product: toProduct(row, activeBarcodes(tx, row.id)) };
      });
    },
  };
}

export type ProductsService = ReturnType<typeof createProductsService>;
