import type { PaymentMethod } from "../../shared/checkout";
import {
  printerMessages,
  type PrinterStatus,
  type PrintResult,
  type SaleJobResult,
} from "../../shared/receipt";
import type { PaperWidthMm, PrinterConnection } from "../../shared/settings";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { receiptPrintRow } from "../db/sale-rows";
import { receiptPrints } from "../db/schema";
import { currentTerminal } from "../db/terminal";
import { drawerKick, receiptJob } from "../hardware/escpos";
import type { PrintJob, PrintJobKind, PrinterTransport } from "../hardware/printer-transport";
import type { Rasterise } from "../receipts/rasterise";
import { buildReceiptModel, buildTestPrintModel } from "../receipts/receipt-model";
import { loadSaleSnapshot, type SaleSnapshot } from "../receipts/sale-snapshot";
import { buildShiftReportModel } from "../receipts/shift-report-model";
import { getPrinterSettings, getReceiptSettings } from "../settings/store-settings";
import type { createAuditService } from "./audit";
import type { ShiftsService } from "./shifts";

export type NonSaleDrawerReason = "cash_in" | "cash_out" | "opening_count" | "closing_count";

interface ReceiptsDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  shifts: Pick<ShiftsService, "report">;
  rasterise: Rasterise;
  transportFor: (connection: PrinterConnection) => PrinterTransport | null;
  log?: (entry: { kind: PrintJobKind; ms: number; successful: boolean }) => void;
}

const keptJobs = 20;

const notSetUp: PrintResult = {
  successful: false,
  canRetry: false,
  message: printerMessages.notSetUp,
};
const saleMissing: PrintResult = {
  successful: false,
  canRetry: false,
  message: "That sale no longer exists. Refresh.",
};
const reportMissing: PrintResult = {
  successful: false,
  canRetry: false,
  message: "That shift no longer exists. Refresh.",
};
const printerFault: PrintResult = {
  successful: false,
  canRetry: true,
  message: printerMessages.error,
};

export function opensDrawer(payments: readonly { method: PaymentMethod }[]): boolean {
  return payments.some((payment) => payment.method === "cash");
}

const widthPxOf = (paperWidthMm: PaperWidthMm) => (paperWidthMm === 58 ? 384 : 576);

export function createReceiptsService({
  database,
  audit,
  sessions,
  shifts,
  rasterise,
  transportFor,
  log,
}: ReceiptsDeps) {
  const { db } = database;
  let printerFailed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const saleJobs = new Map<string, Promise<SaleJobResult>>();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  }

  function printerNow() {
    const terminal = currentTerminal(db);
    const printer = getPrinterSettings(db, terminal.id);
    return { terminal, printer, transport: transportFor(printer.connection) };
  }

  async function transmit(job: PrintJob): Promise<PrintResult> {
    const { transport } = printerNow();
    if (!transport) return notSetUp;
    const started = performance.now();
    let result: PrintResult;
    try {
      result = await transport.send(job);
    } catch {
      result = printerFault;
    }
    log?.({
      kind: job.kind,
      ms: Math.round(performance.now() - started),
      successful: result.successful,
    });
    if (!result.successful) printerFailed = true;
    else if (job.kind !== "drawer") printerFailed = false;
    return result;
  }

  async function sendImage(
    kind: "receipt" | "report" | "test",
    model: Parameters<Rasterise>[0],
  ): Promise<PrintResult> {
    const raster = await rasterise(model);
    return transmit({
      kind,
      bytes: receiptJob(raster.image),
      ...(raster.previewPng ? { previewPng: raster.previewPng } : {}),
    });
  }

  async function printSale(snapshot: SaleSnapshot, printedBy: string): Promise<PrintResult> {
    try {
      if (!printerNow().transport) return notSetUp;
      const model = buildReceiptModel(snapshot, widthPxOf(snapshot.paperWidthMm));
      const result = await sendImage("receipt", model);
      if (result.successful) {
        const { terminal } = printerNow();
        db.insert(receiptPrints)
          .values(
            receiptPrintRow({
              sale: { id: snapshot.sale.id, storeId: terminal.storeId, terminalId: terminal.id },
              printedBy,
            }),
          )
          .run();
      }
      return result;
    } catch {
      printerFailed = true;
      return printerFault;
    }
  }

  async function runSaleJob(saleId: string, userId: string): Promise<SaleJobResult> {
    try {
      const snapshot = loadSaleSnapshot(db, saleId);
      if (!snapshot) return { state: "none" };
      const { printer, transport } = printerNow();
      const hasReturn = snapshot.lines.some((line) => line.isReturn);
      if (!transport) {
        return printer.printMode === "off" && !hasReturn
          ? { state: "off" }
          : { state: "no-printer", message: printerMessages.notSetUp };
      }
      if (opensDrawer(snapshot.payments)) {
        await transmit({ kind: "drawer", bytes: drawerKick(), reason: "sale" });
      }
      if (printer.printMode === "ask" && !hasReturn) return { state: "ask" };
      if (printer.printMode === "off" && !hasReturn) return { state: "off" };
      const result = await printSale(snapshot, userId);
      return result.successful
        ? { state: "printed" }
        : { state: "failed", canRetry: result.canRetry, message: result.message };
    } catch {
      printerFailed = true;
      return { state: "failed", canRetry: true, message: printerMessages.error };
    }
  }

  function startAfterSale(saleId: string): void {
    const { userId } = requireSession(sessions);
    const job = (async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return enqueue(() => runSaleJob(saleId, userId));
    })();
    saleJobs.set(saleId, job);
    if (saleJobs.size > keptJobs) {
      const oldest = saleJobs.keys().next().value;
      if (oldest !== undefined) saleJobs.delete(oldest);
    }
  }

  async function saleJob({ saleId }: { saleId: string }): Promise<SaleJobResult> {
    requireSession(sessions);
    return (await saleJobs.get(saleId)) ?? { state: "none" };
  }

  function print({ saleId }: { saleId: string }): Promise<PrintResult> {
    const { userId } = requireSession(sessions);
    return enqueue(async () => {
      try {
        const snapshot = loadSaleSnapshot(db, saleId);
        return snapshot ? await printSale(snapshot, userId) : saleMissing;
      } catch {
        printerFailed = true;
        return printerFault;
      }
    });
  }

  function printShiftReport({ shiftId }: { shiftId: string }): Promise<PrintResult> {
    requireSession(sessions);
    return enqueue(async () => {
      try {
        const found = shifts.report({ id: shiftId });
        if (!found.ok) return reportMissing;
        const { terminal, printer, transport } = printerNow();
        if (!transport) return notSetUp;
        const store = getReceiptSettings(db, terminal.storeId);
        return await sendImage(
          "report",
          buildShiftReportModel(found.report, store, widthPxOf(printer.paperWidthMm)),
        );
      } catch {
        printerFailed = true;
        return printerFault;
      }
    });
  }

  function testPrint(): Promise<PrintResult> {
    requireSession(sessions);
    return enqueue(async () => {
      try {
        const { terminal, printer, transport } = printerNow();
        if (!transport) return notSetUp;
        const store = getReceiptSettings(db, terminal.storeId);
        const model = buildTestPrintModel(
          store,
          printer.paperWidthMm,
          widthPxOf(printer.paperWidthMm),
        );
        return await sendImage("test", model);
      } catch {
        printerFailed = true;
        return printerFault;
      }
    });
  }

  function kickAndAudit(
    reason: NonSaleDrawerReason | "test",
    userId: string,
  ): Promise<PrintResult> {
    return enqueue(async () => {
      const { terminal, transport } = printerNow();
      if (!transport) return notSetUp;
      const result = await transmit({ kind: "drawer", bytes: drawerKick(), reason });
      audit.record({
        action: "drawer_open_no_sale",
        actorUserId: userId,
        entityType: "terminal",
        entityId: terminal.id,
        details: { reason, successful: result.successful },
      });
      return result;
    });
  }

  function testDrawer(): Promise<PrintResult> {
    const { userId } = requireSession(sessions);
    return kickAndAudit("test", userId);
  }

  async function openDrawer(reason: NonSaleDrawerReason): Promise<PrintResult> {
    try {
      const { userId } = requireSession(sessions);
      return await kickAndAudit(reason, userId);
    } catch {
      return printerFault;
    }
  }

  function status(): PrinterStatus {
    requireSession(sessions);
    if (!printerNow().transport) {
      return { state: "not-set-up", message: printerMessages.notSetUp };
    }
    return printerFailed
      ? { state: "error", message: printerMessages.error }
      : { state: "ok", message: "" };
  }

  return {
    startAfterSale,
    saleJob,
    print,
    printShiftReport,
    testPrint,
    testDrawer,
    openDrawer,
    status,
  };
}

export type ReceiptsService = ReturnType<typeof createReceiptsService>;
