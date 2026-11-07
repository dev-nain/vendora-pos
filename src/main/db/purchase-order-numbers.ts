import { sql } from "drizzle-orm";
import { formatInvoiceNo } from "./invoice-numbers";
import { terminalPurchaseOrderSequences } from "./schema";
import type { DbExecutor } from "./terminal";

export function formatPurchaseOrderNo(terminalCode: string, seq: number): string {
  return `PO-${formatInvoiceNo(terminalCode, seq)}`;
}

// Call inside the order transaction so a rollback gives the number back and leaves no gap.
export function takePurchaseOrderNumber(
  tx: DbExecutor,
  terminal: { id: string; storeId: string; code: string },
): string {
  const row = tx
    .insert(terminalPurchaseOrderSequences)
    .values({ terminalId: terminal.id, storeId: terminal.storeId, nextSeq: 2 })
    .onConflictDoUpdate({
      target: terminalPurchaseOrderSequences.terminalId,
      set: { nextSeq: sql`${terminalPurchaseOrderSequences.nextSeq} + 1`, updatedAt: new Date() },
    })
    .returning({ nextSeq: terminalPurchaseOrderSequences.nextSeq })
    .get();
  return formatPurchaseOrderNo(terminal.code, row.nextSeq - 1);
}
