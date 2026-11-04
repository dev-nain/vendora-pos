import { formatRupees } from "../../shared/money";
import type { ReceiptBlock, ReceiptModel, ReceiptWidthPx } from "../../shared/receipt";
import type { ReceiptSettings } from "../../shared/settings";
import type { CashMove, ShiftReport } from "../../shared/shifts";
import {
  formatReceiptDateTime,
  formatReceiptTime,
  headerBlocks,
  metricsFor,
  negativeRupees,
  pair,
  rateText,
  signedRupees,
  text,
} from "./receipt-model";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const rule: ReceiptBlock = { type: "rule" };

const heading = (title: string): ReceiptBlock => text(title, { weight: "bold" });

function varianceText(variance: number): string {
  if (variance === 0) return "No variance";
  return `${variance < 0 ? "Short" : "Over"} ${formatRupees(Math.abs(variance))}`;
}

function movesBlocks(
  title: string,
  kind: "in" | "out",
  moves: CashMove[],
  totalPaisa: number,
): ReceiptBlock[] {
  const amount = (paisa: number) => (kind === "out" ? negativeRupees(paisa) : formatRupees(paisa));
  const blocks: ReceiptBlock[] = [heading(title)];
  if (moves.length === 0) blocks.push(text("None"));
  for (const move of moves) {
    blocks.push(
      pair(
        `${formatReceiptTime(new Date(move.createdAt))} ${move.reason}`,
        amount(move.amountPaisa),
      ),
    );
  }
  blocks.push(pair("Total", amount(totalPaisa), { weight: "bold" }));
  return blocks;
}

export function buildShiftReportModel(
  report: ShiftReport,
  store: ReceiptSettings,
  widthPx: ReceiptWidthPx,
): ReceiptModel {
  const blocks: ReceiptBlock[] = [...headerBlocks(store)];
  blocks.push(
    text(report.kind === "x" ? "X-report" : "Z-report", {
      align: "center",
      size: "title",
      weight: "bold",
    }),
    rule,
    pair("Terminal", report.terminalCode),
    pair("Opened", formatReceiptDateTime(new Date(report.openedAt))),
    text(`by ${report.openedBy}`),
  );
  if (report.closedAt && report.closedBy) {
    blocks.push(
      pair("Closed", formatReceiptDateTime(new Date(report.closedAt))),
      text(`by ${report.closedBy}`),
    );
  }
  blocks.push(rule, heading("Sales by payment method"));
  blocks.push(
    text(
      `${plural(report.sales.billCount, "bill", "bills")} · ${plural(report.sales.refundBillCount, "refund", "refunds")}`,
    ),
  );
  for (const method of report.sales.byMethod) {
    blocks.push(pair(method.label, signedRupees(method.amountPaisa)));
  }
  blocks.push(pair("Total sales", signedRupees(report.sales.totalPaisa), { weight: "bold" }), rule);

  blocks.push(heading("Taxes"));
  if (report.taxes.length === 0) blocks.push(text("None"));
  else {
    blocks.push({
      type: "table",
      header: ["Rate", "Taxable", "Tax"],
      rows: report.taxes.map((tax) => [
        rateText(tax.rateBps),
        signedRupees(tax.taxablePaisa),
        signedRupees(tax.taxPaisa),
      ]),
    });
  }
  blocks.push(rule, heading("Discounts"));
  blocks.push(
    pair(
      plural(report.discounts.count, "bill", "bills"),
      formatRupees(report.discounts.amountPaisa),
    ),
  );
  blocks.push(heading("Refunds"));
  blocks.push(
    pair(plural(report.refunds.count, "line", "lines"), negativeRupees(report.refunds.amountPaisa)),
  );
  blocks.push(rule, heading("Opening float"));
  blocks.push(pair("Float", formatRupees(report.openingFloatPaisa)), rule);

  blocks.push(...movesBlocks("Cash in", "in", report.cashIn.moves, report.cashIn.totalPaisa));
  blocks.push(rule);
  blocks.push(...movesBlocks("Cash out", "out", report.cashOut.moves, report.cashOut.totalPaisa));
  blocks.push(rule, heading("Expected by payment method"));
  for (const method of report.expectedByMethod) {
    blocks.push(pair(method.label, signedRupees(method.expectedPaisa), { weight: "bold" }));
  }
  blocks.push(rule, heading("Deleted lines and discarded bills"));
  blocks.push(
    pair("Deleted lines", String(report.deletedLines.count)),
    pair("Discarded bills", String(report.discardedBills.count)),
  );

  if (report.count && report.variancePaisa !== null) {
    blocks.push(rule, heading("Counted cash"));
    if (report.count.method === "denominations") {
      for (const line of report.count.lines) {
        blocks.push(
          pair(`${formatRupees(line.valuePaisa)} × ${line.count}`, formatRupees(line.totalPaisa)),
        );
      }
    } else {
      blocks.push(text("Entered as a total"));
    }
    blocks.push(
      pair("Counted", formatRupees(report.count.countedCashPaisa), { weight: "bold" }),
      pair("Variance", varianceText(report.variancePaisa), { weight: "bold" }),
    );
  }
  if (report.note) blocks.push(rule, heading("Note"), text(report.note));

  return { widthPx, metrics: metricsFor(widthPx), blocks };
}
