import {
  postGoodsReceivedInputSchema,
  supplierInvoiceNoSchema,
  type GoodsReceivedNote,
  type PostGoodsReceivedInput,
} from "@shared/goods-received";
import type { BarcodeLookup, ProductUnit } from "@shared/products";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderSummary,
} from "@shared/purchase-orders";
import { parseRupees, rupeeInputText } from "../lib/money";
import { parseQuantityMilli, quantityInputText } from "../lib/quantity";
import {
  costError,
  lineProjection,
  orderFormMessages,
  orderTotal,
  quantityError,
  type OrderLineDraft,
  type OrderLineErrors,
  type OrderProduct,
} from "./order-form";

export interface GrnLineDraft extends OrderLineDraft {
  purchaseOrderLineId: string | null;
  remainingQtyMilli: number | null;
}

export interface GrnFormValues {
  supplierId: string | null;
  supplierInvoiceNo: string;
  lines: GrnLineDraft[];
}

export type GrnSource = { kind: "direct" } | { kind: "order"; order: PurchaseOrder };

export interface GrnFormErrors {
  supplier?: string;
  invoice?: string;
  lines?: string;
  line: Record<string, OrderLineErrors>;
}

export interface GrnAddResult {
  lines: GrnLineDraft[];
  key: string;
}

export type ScanMatch =
  | { kind: "existing"; key: string }
  | { kind: "order-line"; line: PurchaseOrderLine }
  | { kind: "new" }
  | { kind: "not-on-order" };

export interface OverReceipt {
  key: string;
  nameEn: string;
  unit: ProductUnit;
  extraMilli: number;
}

export const grnFormMessages = {
  noOrderLines: "Enter a quantity on at least one line.",
} as const;

export const emptyGrnForm = (): GrnFormValues => ({
  supplierId: null,
  supplierInvoiceNo: "",
  lines: [],
});

const orderLineDraft = (line: PurchaseOrderLine, qtyMilli: number): GrnLineDraft => ({
  key: crypto.randomUUID(),
  productId: line.productId,
  nameEn: line.nameEn,
  nameUr: line.nameUr,
  unit: line.unit,
  qtyText: qtyMilli > 0 ? quantityInputText(qtyMilli, line.unit) : "",
  costText: rupeeInputText(line.unitCostPaisa),
  purchaseOrderLineId: line.id,
  remainingQtyMilli: line.remainingQtyMilli,
});

export const grnFormFromOrder = (order: PurchaseOrder): GrnFormValues => ({
  supplierId: order.supplierId,
  supplierInvoiceNo: "",
  lines: order.lines
    .filter((line) => line.remainingQtyMilli > 0)
    .map((line) => orderLineDraft(line, line.remainingQtyMilli)),
});

export const receivableOrders = (orders: readonly PurchaseOrderSummary[]): PurchaseOrderSummary[] =>
  orders.filter((order) => order.status === "confirmed" || order.status === "partly_received");

const firstWithRemaining = <Line extends { remainingQtyMilli: number | null }>(
  lines: readonly Line[],
): Line | undefined => lines.find((line) => (line.remainingQtyMilli ?? 0) > 0) ?? lines[0];

export function matchScan(
  lines: readonly GrnLineDraft[],
  source: GrnSource,
  productId: string,
): ScanMatch {
  const inForm = firstWithRemaining(lines.filter((line) => line.productId === productId));
  if (inForm) return { kind: "existing", key: inForm.key };
  if (source.kind === "direct") return { kind: "new" };
  const onOrder = firstWithRemaining(
    source.order.lines.filter((line) => line.productId === productId),
  );
  return onOrder ? { kind: "order-line", line: onOrder } : { kind: "not-on-order" };
}

export function addOrderLine(
  lines: readonly GrnLineDraft[],
  orderLine: PurchaseOrderLine,
  qtyMilli: number,
): GrnAddResult {
  const added = orderLineDraft(orderLine, qtyMilli);
  return { lines: [...lines, added], key: added.key };
}

export function addDirectLine(
  lines: readonly GrnLineDraft[],
  product: OrderProduct,
  qtyMilli: number,
  costPaisa: number,
): GrnAddResult {
  const added: GrnLineDraft = {
    key: crypto.randomUUID(),
    productId: product.id,
    nameEn: product.nameEn,
    nameUr: product.nameUr,
    unit: product.unit,
    qtyText: qtyMilli > 0 ? quantityInputText(qtyMilli, product.unit) : "",
    costText: rupeeInputText(costPaisa),
    purchaseOrderLineId: null,
    remainingQtyMilli: null,
  };
  return { lines: [...lines, added], key: added.key };
}

export const scanQtyMilli = (lookup: BarcodeLookup): number =>
  lookup.source === "barcode" ? lookup.packQtyMilli : 0;

export const defaultCostPaisa = (
  lastCostPaisa: number | null,
  product: Pick<OrderProduct, "costPaisa">,
): number => lastCostPaisa ?? product.costPaisa;

export function overReceipts(lines: readonly GrnLineDraft[]): OverReceipt[] {
  return lines.flatMap((line) => {
    if (line.purchaseOrderLineId === null || line.remainingQtyMilli === null) return [];
    const parsed = parseQuantityMilli(line.qtyText, line.unit);
    if (!parsed.ok || parsed.milli <= line.remainingQtyMilli) return [];
    return [
      {
        key: line.key,
        nameEn: line.nameEn,
        unit: line.unit,
        extraMilli: parsed.milli - line.remainingQtyMilli,
      },
    ];
  });
}

export function isGrnFormDirty(initial: GrnFormValues, current: GrnFormValues): boolean {
  return (
    initial.supplierId !== current.supplierId ||
    initial.supplierInvoiceNo !== current.supplierInvoiceNo ||
    JSON.stringify(initial.lines.map(lineProjection)) !==
      JSON.stringify(current.lines.map(lineProjection))
  );
}

export const grnTotal = (lines: readonly OrderLineDraft[]): number => orderTotal(lines);

export const grnFormFromNote = (note: GoodsReceivedNote): OrderLineDraft[] =>
  note.lines.map((line) => ({
    key: line.id,
    productId: line.productId,
    nameEn: line.nameEn,
    nameUr: line.nameUr,
    unit: line.unit,
    qtyText: quantityInputText(line.qtyMilli, line.unit),
    costText: rupeeInputText(line.unitCostPaisa),
  }));

interface PayloadLine {
  draft: GrnLineDraft;
  qtyMilli: number;
  unitCostPaisa: number;
}

export function buildGrnPayload(
  source: GrnSource,
  values: GrnFormValues,
): { ok: true; payload: PostGoodsReceivedInput } | { ok: false; errors: GrnFormErrors } {
  const errors: GrnFormErrors = { line: {} };
  const isOrder = source.kind === "order";
  if (!isOrder && values.supplierId === null) errors.supplier = orderFormMessages.supplier;

  const invoice = supplierInvoiceNoSchema.safeParse(values.supplierInvoiceNo);
  if (!invoice.success) errors.invoice = invoice.error.issues[0]?.message ?? "";

  const kept: PayloadLine[] = [];
  for (const draft of values.lines) {
    const parsedQty = parseQuantityMilli(draft.qtyText, draft.unit);
    if (isOrder && parsedQty.ok && parsedQty.milli === 0) continue;
    const qty = isOrder && parsedQty.ok ? null : quantityError(draft);
    const cost = costError(draft);
    if (qty || cost) {
      errors.line[draft.key] = { ...(qty ? { qty } : {}), ...(cost ? { cost } : {}) };
      continue;
    }
    const parsedCost = parseRupees(draft.costText);
    if (parsedQty.ok && parsedCost.ok) {
      kept.push({ draft, qtyMilli: parsedQty.milli, unitCostPaisa: parsedCost.paisa });
    }
  }
  if (kept.length === 0 && Object.keys(errors.line).length === 0) {
    errors.lines = isOrder ? grnFormMessages.noOrderLines : orderFormMessages.noLines;
  }

  const hasErrors =
    errors.supplier || errors.invoice || errors.lines || Object.keys(errors.line).length > 0;
  if (hasErrors) return { ok: false, errors };

  const supplierInvoiceNo = invoice.data!;
  const payload: PostGoodsReceivedInput =
    source.kind === "order"
      ? {
          kind: "order",
          purchaseOrderId: source.order.id,
          supplierInvoiceNo,
          lines: kept.map(({ draft, qtyMilli, unitCostPaisa }) => ({
            purchaseOrderLineId: draft.purchaseOrderLineId!,
            qtyMilli,
            unitCostPaisa,
          })),
        }
      : {
          kind: "direct",
          supplierId: values.supplierId!,
          supplierInvoiceNo,
          lines: kept.map(({ draft, qtyMilli, unitCostPaisa }) => ({
            productId: draft.productId,
            qtyMilli,
            unitCostPaisa,
          })),
        };

  const parsed = postGoodsReceivedInputSchema.safeParse(payload);
  if (parsed.success) return { ok: true, payload };

  for (const issue of parsed.error.issues) {
    const [head, index, field] = issue.path;
    if (head === "supplierInvoiceNo") errors.invoice ??= issue.message;
    else if (head === "lines" && typeof index === "number") {
      const key = kept[index]?.draft.key;
      if (!key) continue;
      const entry = (errors.line[key] ??= {});
      if (field === "qtyMilli") {
        entry.qty ??= issue.code === "custom" ? issue.message : orderFormMessages.qtyTooLarge;
      } else {
        entry.cost ??= orderFormMessages.costTooLarge;
      }
    } else if (head === "lines") errors.lines ??= issue.message;
  }
  return { ok: false, errors };
}
