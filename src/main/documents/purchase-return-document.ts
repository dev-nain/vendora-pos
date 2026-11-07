import type { DocumentModel, DocumentPair, DocumentPanel } from "../../shared/document";
import { formatRupees } from "../../shared/money";
import { purchaseReturnReasonLabels, type PurchaseReturn } from "../../shared/purchase-returns";
import { formatQuantity } from "../../shared/quantity";
import type { ReceiptSettings } from "../../shared/settings";
import { buildStorePanel, formatDate, labelled, present } from "./store-panel";
import type { PurchaseOrderSupplier } from "./purchase-order-document";

interface Input {
  purchaseReturn: PurchaseReturn;
  store: ReceiptSettings;
  supplier: PurchaseOrderSupplier;
}

export function buildPurchaseReturnDocument({
  purchaseReturn,
  store,
  supplier,
}: Input): DocumentModel {
  const storeDetails = buildStorePanel(store);
  const supplierPanel: DocumentPanel = {
    label: "Supplier",
    lines: [
      purchaseReturn.supplierName,
      ...labelled("Contact", supplier.contactPerson),
      ...labelled("Phone", supplier.phone),
      ...labelled("NTN", supplier.ntn),
    ],
  };
  const facts: DocumentPair[] = [
    { label: "Date", value: formatDate(purchaseReturn.createdAt) },
    { label: "Reason", value: purchaseReturnReasonLabels[purchaseReturn.reason] },
    ...(purchaseReturn.grnNo
      ? [{ label: "Goods received note", value: purchaseReturn.grnNo }]
      : []),
    ...(purchaseReturn.supplierInvoiceNo
      ? [{ label: "Supplier invoice", value: purchaseReturn.supplierInvoiceNo }]
      : []),
    { label: "Returned by", value: purchaseReturn.actorName },
  ];

  return {
    title: "Purchase return",
    reference: purchaseReturn.returnNo,
    panels: storeDetails.lines.length > 0 ? [storeDetails, supplierPanel] : [supplierPanel],
    facts,
    columns: [
      { label: "#", align: "left", width: "6%" },
      { label: "Product", align: "left" },
      { label: "Quantity", align: "right", width: "17%" },
      { label: "Unit cost", align: "right", width: "17%" },
      { label: "Line total", align: "right", width: "17%" },
    ],
    rows: purchaseReturn.lines.map((line, index) => [
      { text: String(index + 1) },
      line.nameUr ? { text: line.nameEn, urdu: line.nameUr } : { text: line.nameEn },
      { text: formatQuantity(line.qtyMilli, line.unit) },
      { text: formatRupees(line.unitCostPaisa) },
      { text: formatRupees(line.lineTotalPaisa) },
    ]),
    totals: [{ label: "Total", value: formatRupees(purchaseReturn.totalPaisa) }],
    notes: present(purchaseReturn.notes) ? purchaseReturn.notes : null,
  };
}
