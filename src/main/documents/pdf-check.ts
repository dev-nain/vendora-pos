import { writeFile } from "node:fs/promises";
import { app } from "electron";
import type { DocumentModel } from "../../shared/document";
import { createDocumentRenderer } from "./document-window";

const rowCount = 60;

function fixedModel(): DocumentModel {
  return {
    title: "Purchase order",
    reference: "PO-T1-000001",
    header: [],
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
    summaries: [],
    notes: "Deliver before Friday.",
    footer: [],
  };
}

export async function runPdfCheck(path: string): Promise<void> {
  try {
    const bytes = await createDocumentRenderer().toPdf(fixedModel());
    await writeFile(path, bytes);
    app.exit(0);
  } catch (error) {
    console.error("PDF check failed", error);
    app.exit(1);
  }
}
