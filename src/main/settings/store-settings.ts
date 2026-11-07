import { eq } from "drizzle-orm";
import type { VendoraDatabase } from "../db/client";
import type { ScaleBarcodeConfig } from "../hardware/scale-barcode";
import { stores, terminals } from "../db/schema";
import type { DbExecutor } from "../db/terminal";
import type { RoundingSettings } from "../../shared/rounding";
import type { PrinterSettings, ReceiptSettings } from "../../shared/settings";

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

export function getReceiptSettings(executor: DbExecutor, storeId: string): ReceiptSettings {
  const row = executor
    .select({
      name: stores.name,
      address: stores.address,
      phone: stores.phone,
      ntn: stores.ntn,
      strn: stores.strn,
      headerEn: stores.receiptHeaderEn,
      headerUr: stores.receiptHeaderUr,
      footerEn: stores.receiptFooterEn,
      footerUr: stores.receiptFooterUr,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .get();
  if (!row) throw new Error("Store not found");
  return row;
}

export function getPrinterSettings(executor: DbExecutor, terminalId: string): PrinterSettings {
  const row = executor
    .select({
      kind: terminals.printerKind,
      name: terminals.printerName,
      host: terminals.printerHost,
      port: terminals.printerPort,
      paperWidthMm: terminals.paperWidthMm,
      printMode: terminals.printMode,
    })
    .from(terminals)
    .where(eq(terminals.id, terminalId))
    .get();
  if (!row) throw new Error("Terminal not found");
  const connection: PrinterSettings["connection"] =
    row.kind === "windows" && row.name
      ? { kind: "windows", name: row.name }
      : row.kind === "network" && row.host && row.port
        ? { kind: "network", host: row.host, port: row.port }
        : { kind: "none" };
  return { connection, paperWidthMm: row.paperWidthMm, printMode: row.printMode };
}

export function getSecondCopyFolder(executor: DbExecutor, terminalId: string): string | null {
  const row = executor
    .select({ folder: terminals.secondCopyFolder })
    .from(terminals)
    .where(eq(terminals.id, terminalId))
    .get();
  if (!row) throw new Error("Terminal not found");
  return row.folder;
}
