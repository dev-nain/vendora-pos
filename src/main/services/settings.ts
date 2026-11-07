import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import type {
  MarginThresholdInput,
  MarginThresholdSetting,
  MiscItemInput,
  MiscItemSetting,
  PrinterSettings,
  ReceiptSettings,
  ScalePrefixesInput,
  ScalePrefixesSetting,
  ShiftVarianceInput,
  ShiftVarianceSetting,
  WindowsPrinter,
} from "../../shared/settings";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { stores, terminals } from "../db/schema";
import { currentTerminal } from "../db/terminal";
import {
  getMarginThresholdBps,
  getMiscItemEnabled,
  getPrinterSettings,
  getReceiptSettings,
  getScalePrefixes,
  getShiftVarianceWarnPaisa,
} from "../settings/store-settings";
import type { createAuditService } from "./audit";

interface SettingsDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
}

export function createSettingsService({ database, audit, sessions }: SettingsDeps) {
  const { db } = database;

  function setScalePrefixes(input: ScalePrefixesInput): ScalePrefixesSetting {
    const session = requireSession(sessions);
    db.transaction((tx) => {
      const from = getScalePrefixes(database, session.storeId);
      if (from.weightPrefix === input.weightPrefix && from.pricePrefix === input.pricePrefix) {
        return;
      }
      tx.update(stores)
        .set({ scaleWeightPrefix: input.weightPrefix, scalePricePrefix: input.pricePrefix })
        .where(eq(stores.id, session.storeId))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "store",
          entityId: session.storeId,
          details: { setting: "scalePrefixes", from: { ...from }, to: { ...input } },
        },
        tx,
      );
    });
    return { weightPrefix: input.weightPrefix, pricePrefix: input.pricePrefix };
  }

  function getMiscItemSetting(): MiscItemSetting {
    const session = requireSession(sessions);
    return { enabled: getMiscItemEnabled(database, session.storeId) };
  }

  function setMiscItemEnabled(input: MiscItemInput): MiscItemSetting {
    const session = requireSession(sessions);
    db.transaction((tx) => {
      const from = getMiscItemEnabled(database, session.storeId);
      if (from === input.enabled) return;
      tx.update(stores)
        .set({ miscItemEnabled: input.enabled })
        .where(eq(stores.id, session.storeId))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "store",
          entityId: session.storeId,
          details: { setting: "miscItemEnabled", from, to: input.enabled },
        },
        tx,
      );
    });
    return { enabled: input.enabled };
  }

  function getShiftVarianceWarn(): ShiftVarianceSetting {
    const session = requireSession(sessions);
    return { warnPaisa: getShiftVarianceWarnPaisa(database, session.storeId) };
  }

  function setShiftVarianceWarn(input: ShiftVarianceInput): ShiftVarianceSetting {
    const session = requireSession(sessions);
    db.transaction((tx) => {
      const from = getShiftVarianceWarnPaisa(database, session.storeId);
      if (from === input.warnPaisa) return;
      tx.update(stores)
        .set({ shiftVarianceWarnPaisa: input.warnPaisa })
        .where(eq(stores.id, session.storeId))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "store",
          entityId: session.storeId,
          details: { setting: "shiftVarianceWarnPaisa", from, to: input.warnPaisa },
        },
        tx,
      );
    });
    return { warnPaisa: input.warnPaisa };
  }

  function getMarginThreshold(): MarginThresholdSetting {
    const session = requireSession(sessions);
    return { thresholdBps: getMarginThresholdBps(db, session.storeId) };
  }

  function setMarginThreshold(input: MarginThresholdInput): MarginThresholdSetting {
    const session = requireSession(sessions);
    db.transaction((tx) => {
      const from = getMarginThresholdBps(tx, session.storeId);
      if (from === input.thresholdBps) return;
      tx.update(stores)
        .set({ marginThresholdBps: input.thresholdBps })
        .where(eq(stores.id, session.storeId))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "store",
          entityId: session.storeId,
          details: { setting: "marginThresholdBps", from, to: input.thresholdBps },
        },
        tx,
      );
    });
    return { thresholdBps: input.thresholdBps };
  }

  function getReceipt(): ReceiptSettings {
    const session = requireSession(sessions);
    return getReceiptSettings(db, session.storeId);
  }

  function setReceipt(to: ReceiptSettings): ReceiptSettings {
    const session = requireSession(sessions);
    db.transaction((tx) => {
      const from = getReceiptSettings(tx, session.storeId);
      if (isDeepStrictEqual(from, to)) return;
      tx.update(stores)
        .set({
          name: to.name,
          address: to.address,
          phone: to.phone,
          ntn: to.ntn,
          strn: to.strn,
          receiptHeaderEn: to.headerEn,
          receiptHeaderUr: to.headerUr,
          receiptFooterEn: to.footerEn,
          receiptFooterUr: to.footerUr,
        })
        .where(eq(stores.id, session.storeId))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "store",
          entityId: session.storeId,
          details: { setting: "receipt", from, to },
        },
        tx,
      );
    });
    return getReceiptSettings(db, session.storeId);
  }

  function getPrinter(): PrinterSettings {
    requireSession(sessions);
    return getPrinterSettings(db, currentTerminal(db).id);
  }

  function setPrinter(to: PrinterSettings): PrinterSettings {
    const session = requireSession(sessions);
    db.transaction((tx) => {
      const terminal = currentTerminal(tx);
      const from = getPrinterSettings(tx, terminal.id);
      if (isDeepStrictEqual(from, to)) return;
      const { connection } = to;
      tx.update(terminals)
        .set({
          printerKind: connection.kind,
          printerName: connection.kind === "windows" ? connection.name : null,
          printerHost: connection.kind === "network" ? connection.host : null,
          printerPort: connection.kind === "network" ? connection.port : null,
          paperWidthMm: to.paperWidthMm,
          printMode: to.printMode,
        })
        .where(eq(terminals.id, terminal.id))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "terminal",
          entityId: terminal.id,
          details: { setting: "printer", from, to },
        },
        tx,
      );
    });
    return getPrinterSettings(db, currentTerminal(db).id);
  }

  async function listWindowsPrinters(
    fetchPrinters: () => Promise<WindowsPrinter[]>,
  ): Promise<WindowsPrinter[]> {
    requireSession(sessions);
    return process.platform === "win32" ? fetchPrinters() : [];
  }

  return {
    listWindowsPrinters,
    getReceipt,
    setReceipt,
    getPrinter,
    setPrinter,
    setScalePrefixes,
    getShiftVarianceWarn,
    setShiftVarianceWarn,
    getMarginThreshold,
    setMarginThreshold,
    getMiscItemEnabled: getMiscItemSetting,
    setMiscItemEnabled,
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
