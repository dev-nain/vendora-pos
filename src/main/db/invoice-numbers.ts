import { sql } from "drizzle-orm";
import { terminalInvoiceSequences } from "./schema";
import type { DbExecutor } from "./terminal";

export function formatInvoiceNo(terminalCode: string, seq: number): string {
  return `${terminalCode}-${String(seq).padStart(6, "0")}`;
}

// Call inside the sale transaction so a rollback gives the number back and leaves no gap.
export function takeInvoiceNumber(
  tx: DbExecutor,
  terminal: { id: string; storeId: string; code: string },
): string {
  const row = tx
    .insert(terminalInvoiceSequences)
    .values({ terminalId: terminal.id, storeId: terminal.storeId, nextSeq: 2 })
    .onConflictDoUpdate({
      target: terminalInvoiceSequences.terminalId,
      set: { nextSeq: sql`${terminalInvoiceSequences.nextSeq} + 1`, updatedAt: new Date() },
    })
    .returning({ nextSeq: terminalInvoiceSequences.nextSeq })
    .get();
  return formatInvoiceNo(terminal.code, row.nextSeq - 1);
}
