import { paymentMethodLabels } from "../../shared/checkout";
import type {
  DocumentModel,
  DocumentPair,
  DocumentPanel,
  DocumentText,
} from "../../shared/document";
import { formatRupees } from "../../shared/money";
import {
  formatReceiptDateTime,
  linesOf,
  quantityLabel,
  rateText,
  saleDocumentTitle,
  signedRupees,
  taxSummary,
} from "../receipts/receipt-model";
import type { SaleSnapshot } from "../receipts/sale-snapshot";

const present = (value: string | null): value is string => value !== null && value.trim() !== "";

function labelled(label: string, value: string | null): string[] {
  return present(value) ? [`${label}: ${value}`] : [];
}

function texts(value: string | null, lang: DocumentText["lang"]): DocumentText[] {
  return linesOf(value).map((text) => ({ text, lang }));
}

export function buildSaleInvoiceDocument(snapshot: SaleSnapshot): DocumentModel {
  const { sale, lines, store } = snapshot;
  const lineDiscountPaisa = lines.reduce((sum, line) => sum + line.lineDiscountPaisa, 0);
  const billDiscountPaisa = lines.reduce((sum, line) => sum + line.billDiscountPaisa, 0);

  const storePanel: DocumentPanel = {
    lines: [
      ...(present(store.name) ? [store.name] : []),
      ...(present(store.address) ? [store.address] : []),
      ...labelled("Phone", store.phone),
      ...labelled("NTN", store.ntn),
      ...labelled("STRN", store.strn),
    ],
  };
  const buyerPanel: DocumentPanel = {
    label: "Buyer",
    lines: [
      ...(present(sale.buyerName) ? [sale.buyerName] : []),
      ...labelled("NTN", sale.buyerNtn),
      ...labelled("CNIC", sale.buyerCnic),
      ...labelled("Phone", sale.buyerPhone),
    ],
  };

  const facts: DocumentPair[] = [
    { label: "Date", value: formatReceiptDateTime(sale.createdAt) },
    ...(sale.refundedInvoiceNo
      ? [{ label: "Original invoice", value: sale.refundedInvoiceNo }]
      : []),
  ];

  const totals: DocumentPair[] = [
    { label: "Subtotal", value: signedRupees(sale.subtotalPaisa) },
    ...(lineDiscountPaisa !== 0
      ? [{ label: "Discount", value: signedRupees(-lineDiscountPaisa) }]
      : []),
    ...(billDiscountPaisa !== 0
      ? [{ label: "Bill discount", value: signedRupees(-billDiscountPaisa) }]
      : []),
    { label: "Sales tax", value: signedRupees(sale.taxPaisa) },
    ...(sale.roundingPaisa !== 0
      ? [{ label: "Rounding", value: signedRupees(sale.roundingPaisa) }]
      : []),
    { label: "Total", value: signedRupees(sale.totalPaisa) },
  ];

  return {
    title: saleDocumentTitle(snapshot),
    reference: sale.invoiceNo,
    header: [...texts(store.headerEn, "en"), ...texts(store.headerUr, "ur")],
    panels: [storePanel, buyerPanel].filter((panel) => panel.lines.length > 0),
    facts,
    columns: [
      { label: "#", align: "left", width: "5%" },
      { label: "Product", align: "left" },
      { label: "Quantity", align: "right", width: "13%" },
      { label: "Unit price", align: "right", width: "13%" },
      { label: "Discount", align: "right", width: "11%" },
      { label: "Tax rate", align: "right", width: "8%" },
      { label: "Tax", align: "right", width: "11%" },
      { label: "Amount", align: "right", width: "13%" },
    ],
    rows: lines.map((line, index) => {
      const name = line.isReturn ? `Return · ${line.nameEn}` : line.nameEn;
      return [
        { text: String(index + 1) },
        line.nameUr ? { text: name, urdu: line.nameUr } : { text: name },
        { text: quantityLabel(line) },
        { text: formatRupees(line.unitPricePaisa) },
        { text: signedRupees(line.discountPaisa) },
        { text: rateText(line.taxRateBps) },
        { text: signedRupees(line.taxPaisa) },
        { text: signedRupees(line.totalPaisa) },
      ];
    }),
    totals,
    summaries: [
      {
        label: "Tax summary",
        columns: [
          { label: "Rate", align: "left" },
          { label: "Taxable", align: "right" },
          { label: "Tax", align: "right" },
        ],
        rows: taxSummary(lines).map((row) => [
          { text: rateText(row.rateBps) },
          { text: signedRupees(row.taxablePaisa) },
          { text: signedRupees(row.taxPaisa) },
        ]),
      },
      {
        label: "Payments",
        columns: [
          { label: "Method", align: "left" },
          { label: "Reference", align: "left" },
          { label: "Amount", align: "right" },
        ],
        rows: snapshot.payments.map((payment) =>
          payment.isChange
            ? [{ text: "Change" }, { text: "" }, { text: formatRupees(-payment.amountPaisa) }]
            : [
                { text: paymentMethodLabels[payment.method] },
                { text: payment.reference ?? "" },
                { text: signedRupees(payment.amountPaisa) },
              ],
        ),
      },
    ],
    notes: null,
    footer: [...texts(store.footerEn, "en"), ...texts(store.footerUr, "ur")],
  };
}
