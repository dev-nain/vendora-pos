import { eq } from "drizzle-orm";
import type { VendoraDatabase } from "../db/client";
import type { ScaleBarcodeConfig } from "../hardware/scale-barcode";
import { stores } from "../db/schema";

export function getCashierDiscountLimitBps(database: VendoraDatabase, storeId: string): number {
  const row = database.db
    .select({ limit: stores.cashierDiscountLimitBps })
    .from(stores)
    .where(eq(stores.id, storeId))
    .get();
  if (!row) throw new Error("Store not found");
  return row.limit;
}

export function getAutoLockMinutes(database: VendoraDatabase, storeId: string): number | null {
  const row = database.db
    .select({ minutes: stores.autoLockMinutes })
    .from(stores)
    .where(eq(stores.id, storeId))
    .get();
  if (!row) throw new Error("Store not found");
  return row.minutes;
}

export function getScalePrefixes(database: VendoraDatabase, storeId: string): ScaleBarcodeConfig {
  const row = database.db
    .select({ weightPrefix: stores.scaleWeightPrefix, pricePrefix: stores.scalePricePrefix })
    .from(stores)
    .where(eq(stores.id, storeId))
    .get();
  if (!row) throw new Error("Store not found");
  return row;
}

export function getMiscItemEnabled(database: VendoraDatabase, storeId: string): boolean {
  const row = database.db
    .select({ enabled: stores.miscItemEnabled })
    .from(stores)
    .where(eq(stores.id, storeId))
    .get();
  if (!row) throw new Error("Store not found");
  return row.enabled;
}
