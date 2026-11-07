import { sql } from "drizzle-orm";
import { formatInvoiceNo } from "./invoice-numbers";
import { terminalPurchaseReturnSequences } from "./schema";
import type { DbExecutor } from "./terminal";

export function formatPurchaseReturnNo(terminalCode: string, seq: number): string {
  return `PRN-${formatInvoiceNo(terminalCode, seq)}`;
}

// Call inside the return transaction so a rollback gives the number back and leaves no gap.
export function takePurchaseReturnNumber(
  tx: DbExecutor,
  terminal: { id: string; storeId: string; code: string },
): string {
  const row = tx
    .insert(terminalPurchaseReturnSequences)
    .values({ terminalId: terminal.id, storeId: terminal.storeId, nextSeq: 2 })
    .onConflictDoUpdate({
      target: terminalPurchaseReturnSequences.terminalId,
      set: { nextSeq: sql`${terminalPurchaseReturnSequences.nextSeq} + 1`, updatedAt: new Date() },
    })
    .returning({ nextSeq: terminalPurchaseReturnSequences.nextSeq })
    .get();
  return formatPurchaseReturnNo(terminal.code, row.nextSeq - 1);
}
