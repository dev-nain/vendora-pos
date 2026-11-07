import type { ReportRange, SalesByDayResult } from "../../shared/reports";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { readSalesByDay } from "../reports/sales-by-day";

interface ReportsDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
}

export function createReportsService({ database, sessions }: ReportsDeps) {
  function salesByDay(range: ReportRange): SalesByDayResult {
    const session = requireSession(sessions);
    return readSalesByDay(database, session.storeId, range);
  }

  return { salesByDay };
}

export type ReportsService = ReturnType<typeof createReportsService>;
