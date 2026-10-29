import { eq } from "drizzle-orm";
import type { VendoraDatabase } from "../db/client";
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
