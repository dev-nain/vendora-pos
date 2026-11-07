import { writeFile } from "node:fs/promises";
import { app } from "electron";
import type { DocumentModel } from "../../shared/document";
import { salesByDayColumns, type SalesByDayRow } from "../../shared/reports";
import { buildReportDocument } from "../reports/report-document";
import { createDocumentRenderer } from "./document-window";

const rowCount = 60;

function fixedModel(): DocumentModel {
  return {
    title: "Purchase order",
    reference: "PO-T1-000001",
    panels: [
      { lines: ["Vendora Test Store", "Main Bazaar, Lahore"] },
      { label: "Supplier", lines: ["Rehman Traders"] },
    ],
    facts: [
      { label: "Date", value: "01-01-2026" },
      { label: "Status", value: "Draft" },
    ],
    columns: [
      { label: "#", align: "left", width: "8%" },
      { label: "Product", align: "left" },
      { label: "Quantity", align: "right", width: "16%" },
      { label: "Unit cost", align: "right", width: "16%" },
      { label: "Line total", align: "right", width: "16%" },
    ],
    rows: Array.from({ length: rowCount }, (_, index) => [
      { text: String(index + 1) },
      index % 2 === 0
        ? { text: `Tapal Danedar ${index + 1}`, urdu: "ٹپال دانے دار چائے" }
        : { text: `Surf Excel ${index + 1}` },
      { text: "24 pcs" },
      { text: "Rs 410.00" },
      { text: "Rs 9,840.00" },
    ]),
    totals: [{ label: "Total", value: "Rs 590,400.00" }],
    notes: "Deliver before Friday.",
  };
}

function reportModel(): DocumentModel {
  const rows: SalesByDayRow[] = Array.from({ length: 31 }, (_, index) => ({
    day: `2026-10-${String(index + 1).padStart(2, "0")}`,
    billCount: 120 + index,
    grossPaisa: 4_220_000,
    returnsPaisa: 100_000,
    discountPaisa: 12_500,
    netPaisa: 4_120_000,
    taxPaisa: 741_600,
    roundingPaisa: index % 2 === 0 ? -50 : 50,
    totalPaisa: 4_861_600 + (index % 2 === 0 ? -50 : 50),
  }));
  return buildReportDocument({
    title: "Sales by day",
    range: { from: "2026-10-01", to: "2026-10-31" },
    store: {
      name: "Vendora Test Store",
      address: "Main Bazaar, Lahore",
      phone: null,
      ntn: null,
      strn: null,
      headerEn: null,
      headerUr: null,
      footerEn: null,
      footerUr: null,
    },
    columns: salesByDayColumns,
    rows,
    totals: {
      billCount: 4_000,
      grossPaisa: 130_820_000,
      returnsPaisa: 3_100_000,
      discountPaisa: 387_500,
      netPaisa: 127_720_000,
      taxPaisa: 22_989_600,
      roundingPaisa: 50,
      totalPaisa: 150_709_650,
    },
  });
}

export async function runPdfCheck(path: string): Promise<void> {
  try {
    const renderer = createDocumentRenderer();
    await writeFile(path, await renderer.toPdf(fixedModel()));
    await writeFile(`${path}.report.pdf`, await renderer.toPdf(reportModel()));
    app.exit(0);
  } catch (error) {
    console.error("PDF check failed", error);
    app.exit(1);
  }
}
