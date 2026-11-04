import { asc } from "drizzle-orm";
import type { VendoraDatabase } from "./client";
import { terminals } from "./schema";

export type DbExecutor =
  | VendoraDatabase["db"]
  | Parameters<Parameters<VendoraDatabase["db"]["transaction"]>[0]>[0];

export function currentTerminal(executor: DbExecutor): {
  id: string;
  storeId: string;
  code: string;
} {
  const terminal = executor
    .select({ id: terminals.id, storeId: terminals.storeId, code: terminals.code })
    .from(terminals)
    .orderBy(asc(terminals.id))
    .limit(1)
    .get();
  if (!terminal) throw new Error("No terminal is configured");
  return terminal;
}
