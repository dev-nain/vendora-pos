import { eq } from "drizzle-orm";
import type { VendoraDatabase } from "../db/client";
import type { ScaleBarcodeConfig } from "../hardware/scale-barcode";
import { stores } from "../db/schema";
import type { DbExecutor } from "../db/terminal";
import type { RoundingSettings } from "../checkout/totals";

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

export function getShiftVarianceWarnPaisa(database: VendoraDatabase, storeId: string): number {
  const row = database.db
    .select({ warnPaisa: stores.shiftVarianceWarnPaisa })
    .from(stores)
    .where(eq(stores.id, storeId))
    .get();
  if (!row) throw new Error("Store not found");
  return row.warnPaisa;
}

export interface CheckoutSettings {
  pricesIncludeTax: boolean;
  standardTaxRateBps: number;
  rounding: RoundingSettings;
}

export function getCheckoutSettings(executor: DbExecutor, storeId: string): CheckoutSettings {
  const row = executor
    .select({
      pricesIncludeTax: stores.pricesIncludeTax,
      standardTaxRateBps: stores.standardTaxRateBps,
      roundingEnabled: stores.cashRoundingEnabled,
      roundingUnit: stores.cashRoundingPaisa,
      roundingCashOnly: stores.cashRoundingCashOnly,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .get();
  if (!row) throw new Error("Store not found");
  const mode = !row.roundingEnabled ? "off" : row.roundingCashOnly ? "cash-only" : "every-bill";
  return {
    pricesIncludeTax: row.pricesIncludeTax,
    standardTaxRateBps: row.standardTaxRateBps,
    rounding: { mode, unitPaisa: row.roundingUnit },
  };
}
