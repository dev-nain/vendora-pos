import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createSessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import {
  categories,
  productBarcodes,
  products,
  stores,
  taxCategories,
  terminals,
  users,
  type ProductUnit,
} from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { ean13CheckDigit } from "../hardware/scale-barcode";
import { createAuditService } from "./audit";
import { createBillDraftsService } from "./bill-drafts";
import { createReturnsService } from "./returns";
import { createSalesService } from "./sales";
import { createShiftsService } from "./shifts";
import { createStockService } from "./stock";

export function scaleCode(prefix: string, item: string, value: string): string {
  const first12 = `${prefix}${item}${value}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}

export function createCheckoutKit() {
  const dir = mkdtempSync(join(tmpdir(), "vendora-checkout-"));
  const database: VendoraDatabase = openDatabase(join(dir, "vendora.db"));
  runMigrations(database, {
    migrationsFolder: join(process.cwd(), "drizzle"),
    backupDir: join(dir, "backups"),
  });
  seedStoreAndTerminal(database);

  const sessions = createSessionStore();
  const audit = createAuditService(database);
  const billDrafts = createBillDraftsService({ database, audit, sessions });
  const stock = createStockService({ database, audit });
  const sales = createSalesService({ database, audit, sessions, stock });
  const returns = createReturnsService({ database, sessions });
  const shifts = createShiftsService({
    database,
    audit,
    sessions,
    heldBills: billDrafts.heldBillsFor,
  });

  const storeId = database.db.select().from(stores).get()!.id;
  const terminalId = database.db.select().from(terminals).get()!.id;
  const categoryId = database.db.select().from(categories).get()!.id;
  const taxCategoryId = (name: string) =>
    database.db
      .select()
      .from(taxCategories)
      .all()
      .find((tax) => tax.name === name)!.id;

  function signIn(name: string) {
    const user =
      database.db.select().from(users).where(eq(users.username, name)).get() ??
      database.db
        .insert(users)
        .values({ username: name, displayName: `${name} name`, passwordHash: "p", pinHash: "q" })
        .returning()
        .get();
    sessions.start({ userId: user.id, storeId, loggedInAt: new Date(0) });
    return user;
  }

  function openShift(floatPaisa = 0): string {
    const result = shifts.open({ openingFloatPaisa: floatPaisa });
    if (!result.ok) throw new Error("open failed");
    return result.shift.id;
  }

  function addProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
    return database.db
      .insert(products)
      .values({
        storeId,
        nameEn: "Tea",
        searchText: "tea",
        categoryId,
        taxCategoryId: taxCategoryId("Standard"),
        unit: "piece" as ProductUnit,
        costPaisa: 8000,
        salePricePaisa: 10000,
        ...overrides,
      })
      .returning()
      .get();
  }

  function addBarcode(
    productId: string,
    barcode: string,
    overrides: Partial<typeof productBarcodes.$inferInsert> = {},
  ) {
    return database.db
      .insert(productBarcodes)
      .values({ storeId, productId, barcode, ...overrides })
      .returning()
      .get();
  }

  function setMiscEnabled(enabled: boolean) {
    database.db.update(stores).set({ miscItemEnabled: enabled }).run();
  }

  function close() {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return {
    dir,
    database,
    sessions,
    audit,
    billDrafts,
    stock,
    sales,
    returns,
    shifts,
    storeId,
    terminalId,
    categoryId,
    taxCategoryId,
    signIn,
    openShift,
    addProduct,
    addBarcode,
    setMiscEnabled,
    close,
  };
}

export type CheckoutKit = ReturnType<typeof createCheckoutKit>;
