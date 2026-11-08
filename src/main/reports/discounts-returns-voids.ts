import {
  returnSummaryKinds,
  type DiscountsReturnsVoidsResult,
  type ReturnSummaryKind,
} from "../../shared/discounts-returns-voids";
import { storeDayBounds, type ReportRange } from "../../shared/reports";
import type { VendoraDatabase } from "../db/client";

const summaryLabels: Record<ReturnSummaryKind, string> = {
  "with-receipt": "With receipt",
  "without-receipt": "Without receipt",
  "back-to-shelf": "Back to shelf",
  damaged: "Damaged",
};

const discountedBills = `FROM sales s
  JOIN users u ON u.id = s.cashier_user_id
  WHERE s.store_id = @storeId AND s.created_at >= @start AND s.created_at < @end AND s.discount_paisa <> 0`;

const damagedLines = `WITH damaged AS (
  SELECT DISTINCT source_id FROM stock_movements WHERE type = 'damage' AND source_type = 'sale_line'
)`;

const returnedLines = `FROM sale_lines sl
  JOIN sales s ON s.id = sl.sale_id
  JOIN products p ON p.id = sl.product_id
  LEFT JOIN damaged d ON d.source_id = sl.id`;

const returnWindow = `WHERE s.store_id = @storeId AND s.created_at >= @start AND s.created_at < @end AND sl.is_return = 1`;

const auditEntries = `FROM audit_log a
  JOIN users u ON u.id = a.actor_user_id`;

const auditWindow = `WHERE a.store_id = @storeId AND a.action = @action AND a.created_at >= @start AND a.created_at < @end`;

const toIso = <Row extends { createdAt: number }>(row: Row) => ({
  ...row,
  createdAt: new Date(row.createdAt).toISOString(),
});

interface Total {
  n: number;
  paisa: number;
}

type Timed<Row> = Omit<Row, "createdAt"> & { createdAt: number };

export function readDiscountsReturnsVoids(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
  { limit }: { limit: number | null },
): DiscountsReturnsVoidsResult {
  const { start, end } = storeDayBounds(range);
  const window = { storeId, start: start.getTime(), end: end.getTime() };
  const capped = { ...window, limit: limit ?? -1 };
  const { sqlite } = database;

  return sqlite.transaction((): DiscountsReturnsVoidsResult => {
    const byUser = sqlite
      .prepare(
        `SELECT s.cashier_user_id AS userId, u.display_name AS userName,
                count(*) AS billCount, sum(s.discount_paisa) AS discountPaisa
         ${discountedBills}
         GROUP BY s.cashier_user_id ORDER BY discountPaisa DESC, userName, userId`,
      )
      .all(window) as DiscountsReturnsVoidsResult["discounts"]["byUser"];

    const bills = (
      sqlite
        .prepare(
          `SELECT s.id AS saleId, s.invoice_no AS invoiceNo, s.created_at AS createdAt,
                  u.display_name AS userName, s.total_paisa AS totalPaisa, s.discount_paisa AS discountPaisa
           ${discountedBills}
           ORDER BY s.created_at DESC, s.id DESC LIMIT @limit`,
        )
        .all(capped) as Timed<DiscountsReturnsVoidsResult["discounts"]["bills"][number]>[]
    ).map(toIso);

    const figures = sqlite
      .prepare(
        `${damagedLines}
         SELECT
           coalesce(sum(sl.refunded_line_id IS NOT NULL), 0) AS withReceiptCount,
           coalesce(sum(CASE WHEN sl.refunded_line_id IS NOT NULL THEN -sl.total_paisa END), 0) AS withReceiptPaisa,
           coalesce(sum(sl.refunded_line_id IS NULL), 0) AS withoutReceiptCount,
           coalesce(sum(CASE WHEN sl.refunded_line_id IS NULL THEN -sl.total_paisa END), 0) AS withoutReceiptPaisa,
           coalesce(sum(p.is_system = 0 AND d.source_id IS NULL), 0) AS shelfCount,
           coalesce(sum(CASE WHEN p.is_system = 0 AND d.source_id IS NULL THEN -sl.total_paisa END), 0) AS shelfPaisa,
           coalesce(sum(p.is_system = 0 AND d.source_id IS NOT NULL), 0) AS damagedCount,
           coalesce(sum(CASE WHEN p.is_system = 0 AND d.source_id IS NOT NULL THEN -sl.total_paisa END), 0) AS damagedPaisa,
           count(*) AS lineCount,
           coalesce(sum(-sl.total_paisa), 0) AS valuePaisa
         ${returnedLines}
         ${returnWindow}`,
      )
      .get(window) as Record<string, number>;
    const summaryFigures: Record<ReturnSummaryKind, [number, number]> = {
      "with-receipt": [figures.withReceiptCount!, figures.withReceiptPaisa!],
      "without-receipt": [figures.withoutReceiptCount!, figures.withoutReceiptPaisa!],
      "back-to-shelf": [figures.shelfCount!, figures.shelfPaisa!],
      damaged: [figures.damagedCount!, figures.damagedPaisa!],
    };

    const lines = (
      sqlite
        .prepare(
          `${damagedLines}
           SELECT sl.id AS lineId, s.id AS saleId, s.invoice_no AS invoiceNo, s.created_at AS createdAt,
                  u.display_name AS userName, sl.name_en AS itemName, sl.unit AS unit, sl.qty_milli AS qtyMilli,
                  orig.invoice_no AS receiptInvoiceNo,
                  CASE WHEN p.is_system = 1 THEN 'no-stock' WHEN d.source_id IS NOT NULL THEN 'damaged' ELSE 'back-to-shelf' END AS disposition,
                  -sl.total_paisa AS valuePaisa
           ${returnedLines}
           JOIN users u ON u.id = s.cashier_user_id
           LEFT JOIN sales orig ON orig.id = sl.refunded_sale_id
           ${returnWindow}
           ORDER BY s.created_at DESC, sl.id DESC LIMIT @limit`,
        )
        .all(capped) as Timed<DiscountsReturnsVoidsResult["returns"]["lines"][number]>[]
    ).map(toIso);

    const deletedTotal = sqlite
      .prepare(
        `SELECT count(*) AS n, coalesce(sum(json_extract(a.details, '$.grossPaisa')), 0) AS paisa
         ${auditEntries}
         ${auditWindow}`,
      )
      .get({ ...window, action: "line_delete" }) as Total;

    const deletedLines = (
      sqlite
        .prepare(
          `SELECT a.id AS auditId, a.created_at AS createdAt, u.display_name AS userName,
                  coalesce(bdl.misc_name, p.name_en, '') AS itemName, coalesce(p.unit, 'piece') AS unit,
                  json_extract(a.details, '$.qtyMilli') AS qtyMilli,
                  CASE WHEN s.id IS NOT NULL THEN 'sold' WHEN bd.state = 'cancelled' THEN 'discarded' ELSE 'not-completed' END AS billState,
                  s.invoice_no AS invoiceNo,
                  json_extract(a.details, '$.grossPaisa') AS grossPaisa
           ${auditEntries}
           LEFT JOIN bill_draft_lines bdl ON bdl.id = a.entity_id
           LEFT JOIN products p ON p.id = bdl.product_id
           LEFT JOIN bill_drafts bd ON bd.id = json_extract(a.details, '$.draftId')
           LEFT JOIN sales s ON s.draft_id = bd.id
           ${auditWindow}
           ORDER BY a.created_at DESC, a.id DESC LIMIT @limit`,
        )
        .all({ ...capped, action: "line_delete" }) as Timed<
        DiscountsReturnsVoidsResult["voids"]["deletedLines"]["rows"][number]
      >[]
    ).map(toIso);

    const discardedTotal = sqlite
      .prepare(
        `SELECT count(*) AS n, coalesce(sum(json_extract(a.details, '$.totalPaisa')), 0) AS paisa
         ${auditEntries}
         ${auditWindow}`,
      )
      .get({ ...window, action: "bill_discard" }) as Total;

    const discardedBills = (
      sqlite
        .prepare(
          `SELECT a.id AS auditId, a.created_at AS createdAt, u.display_name AS userName,
                  json_extract(a.details, '$.lineCount') AS lineCount,
                  json_extract(a.details, '$.totalPaisa') AS totalPaisa
           ${auditEntries}
           ${auditWindow}
           ORDER BY a.created_at DESC, a.id DESC LIMIT @limit`,
        )
        .all({ ...capped, action: "bill_discard" }) as Timed<
        DiscountsReturnsVoidsResult["voids"]["discardedBills"]["rows"][number]
      >[]
    ).map(toIso);

    return {
      discounts: {
        byUser,
        bills,
        billCount: byUser.reduce((sum, row) => sum + row.billCount, 0),
        discountPaisa: byUser.reduce((sum, row) => sum + row.discountPaisa, 0),
      },
      returns: {
        summary: returnSummaryKinds.map((kind) => ({
          kind,
          label: summaryLabels[kind],
          lineCount: summaryFigures[kind][0],
          valuePaisa: summaryFigures[kind][1],
        })),
        lines,
        lineCount: figures.lineCount!,
        valuePaisa: figures.valuePaisa!,
      },
      voids: {
        deletedLines: {
          rows: deletedLines,
          count: deletedTotal.n,
          grossPaisa: deletedTotal.paisa,
        },
        discardedBills: {
          rows: discardedBills,
          count: discardedTotal.n,
          totalPaisa: discardedTotal.paisa,
        },
      },
    };
  })();
}
