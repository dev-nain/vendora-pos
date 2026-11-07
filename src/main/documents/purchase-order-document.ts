import type { DocumentModel, DocumentPair, DocumentPanel } from "../../shared/document";
import { formatRupees } from "../../shared/money";
import { purchaseOrderStatusLabels, type PurchaseOrder } from "../../shared/purchase-orders";
import { formatQuantity } from "../../shared/quantity";
import type { ReceiptSettings } from "../../shared/settings";

export interface PurchaseOrderSupplier {
  contactPerson: string | null;
  phone: string | null;
  ntn: string | null;
}

interface Input {
  order: PurchaseOrder;
  store: ReceiptSettings;
  supplier: PurchaseOrderSupplier;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

const present = (value: string | null): value is string => value !== null && value.trim() !== "";

function labelled(label: string, value: string | null): string[] {
  return present(value) ? [`${label}: ${value}`] : [];
}

export function buildPurchaseOrderDocument({ order, store, supplier }: Input): DocumentModel {
  const storePanel: DocumentPanel = {
    lines: [
      ...(present(store.name) ? [store.name] : []),
      ...(present(store.address) ? [store.address] : []),
      ...labelled("Phone", store.phone),
      ...labelled("NTN", store.ntn),
      ...labelled("STRN", store.strn),
    ],
  };
  const supplierPanel: DocumentPanel = {
    label: "Supplier",
    lines: [
      order.supplierName,
      ...labelled("Contact", supplier.contactPerson),
      ...labelled("Phone", supplier.phone),
      ...labelled("NTN", supplier.ntn),
    ],
  };
  const facts: DocumentPair[] = [
    { label: "Date", value: formatDate(order.createdAt) },
    { label: "Status", value: purchaseOrderStatusLabels[order.status] },
    { label: "Prepared by", value: order.createdByName },
  ];

  return {
    title: "Purchase order",
    reference: order.orderNo,
    header: [],
    panels: storePanel.lines.length > 0 ? [storePanel, supplierPanel] : [supplierPanel],
    facts,
    columns: [
      { label: "#", align: "left", width: "6%" },
      { label: "Product", align: "left" },
      { label: "Quantity", align: "right", width: "17%" },
      { label: "Unit cost", align: "right", width: "17%" },
      { label: "Line total", align: "right", width: "17%" },
    ],
    rows: order.lines.map((line, index) => [
      { text: String(index + 1) },
      line.nameUr ? { text: line.nameEn, urdu: line.nameUr } : { text: line.nameEn },
      { text: formatQuantity(line.orderedQtyMilli, line.unit) },
      { text: formatRupees(line.unitCostPaisa) },
      { text: formatRupees(line.lineTotalPaisa) },
    ]),
    totals: [{ label: "Total", value: formatRupees(order.totalPaisa) }],
    summaries: [],
    notes: present(order.notes) ? order.notes : null,
    footer: [],
  };
}
