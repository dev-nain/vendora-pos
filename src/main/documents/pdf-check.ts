import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow } from "electron";
import type { DocumentModel } from "../../shared/document";
import type { SaleSnapshot, SnapshotLine } from "../receipts/sale-snapshot";
import { createDocumentRenderer } from "./document-window";
import { buildSaleInvoiceDocument } from "./sale-invoice-document";

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

function fixedSnapshot(): SaleSnapshot {
  const lines: SnapshotLine[] = Array.from({ length: rowCount }, (_, index) => {
    const isReturn = index === 5;
    const sign = isReturn ? -1 : 1;
    const taxRateBps = index % 3 === 0 ? 0 : 1800;
    const totalPaisa = sign * 11800;
    const taxPaisa = taxRateBps === 0 ? 0 : sign * 1800;
    return {
      nameEn: `Tapal Danedar ${index + 1}`,
      nameUr: index % 2 === 0 ? "ٹپال دانے دار چائے" : null,
      unit: "piece",
      qtyMilli: sign * 1000,
      packQtyMilli: 1000,
      isReturn,
      unitPricePaisa: 11800,
      taxRateBps,
      grossPaisa: totalPaisa,
      lineDiscountPaisa: 0,
      billDiscountPaisa: 0,
      discountPaisa: 0,
      taxPaisa,
      totalPaisa,
    };
  });
  const totalPaisa = lines.reduce((sum, line) => sum + line.totalPaisa, 0);
  const taxPaisa = lines.reduce((sum, line) => sum + line.taxPaisa, 0);
  return {
    sale: {
      id: "check",
      invoiceNo: "T1-000001",
      type: "sale",
      refundedInvoiceNo: null,
      createdAt: new Date(2026, 0, 1, 10, 30),
      subtotalPaisa: totalPaisa,
      discountPaisa: 0,
      taxPaisa,
      roundingPaisa: 0,
      totalPaisa,
      buyerName: "Bilal Traders",
      buyerNtn: "1234567-8",
      buyerCnic: "35202-1234567-1",
      buyerPhone: "03001234567",
    },
    cashierName: "Ayesha",
    lines,
    payments: [
      { method: "card", amountPaisa: 300000, reference: "4321", isChange: false },
      { method: "cash", amountPaisa: 400000, reference: null, isChange: false },
      { method: "cash", amountPaisa: -(700000 - totalPaisa), reference: null, isChange: true },
    ],
    store: {
      name: "Vendora Test Store",
      address: "Main Bazaar, Lahore",
      phone: "042-1234567",
      ntn: "7654321-0",
      strn: "1234567890123",
      headerEn: "Welcome\nOpen daily",
      headerUr: "خوش آمدید",
      footerEn: "Thank you",
      footerUr: "شکریہ",
    },
    paperWidthMm: 80,
  };
}

export async function runPdfCheck(path: string): Promise<void> {
  try {
    // Destroying the first document window would otherwise quit the app via window-all-closed.
    const keepAlive = new BrowserWindow({ show: false });
    const renderer = createDocumentRenderer();
    await writeFile(path, await renderer.toPdf(fixedModel()));
    await writeFile(
      join(dirname(path), "invoice.pdf"),
      await renderer.toPdf(buildSaleInvoiceDocument(fixedSnapshot())),
    );
    keepAlive.destroy();
    app.exit(0);
  } catch (error) {
    console.error("PDF check failed", error);
    app.exit(1);
  }
}
