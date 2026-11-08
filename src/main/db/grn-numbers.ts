import { sql } from "drizzle-orm";
import { formatInvoiceNo } from "./invoice-numbers";
import { terminalGrnSequences } from "./schema";
import type { DbExecutor } from "./terminal";

export function formatGrnNo(terminalCode: string, seq: number): string {
  return `GRN-${formatInvoiceNo(terminalCode, seq)}`;
}

// Call inside the GRN transaction so a rollback gives the number back and leaves no gap.
export function takeGrnNumber(
  tx: DbExecutor,
  terminal: { id: string; storeId: string; code: string },
): string {
  const row = tx
    .insert(terminalGrnSequences)
    .values({ terminalId: terminal.id, storeId: terminal.storeId, nextSeq: 2 })
    .onConflictDoUpdate({
      target: terminalGrnSequences.terminalId,
      set: { nextSeq: sql`${terminalGrnSequences.nextSeq} + 1`, updatedAt: new Date() },
    })
    .returning({ nextSeq: terminalGrnSequences.nextSeq })
    .get();
  return formatGrnNo(terminal.code, row.nextSeq - 1);
}
