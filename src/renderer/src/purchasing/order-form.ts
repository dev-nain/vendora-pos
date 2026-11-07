import type { LowStockItem } from "@shared/inventory";
import type { BarcodeLookup, ProductUnit } from "@shared/products";
import {
  createPurchaseOrderInputSchema,
  purchaseOrderLineInputSchema,
  purchaseOrderLineTotalPaisa,
  type CreatePurchaseOrderInput,
  type PurchaseOrder,
} from "@shared/purchase-orders";
import { parseRupees, rupeeInputText } from "../lib/money";
import { parseQuantityMilli, quantityInputText } from "../lib/quantity";

export interface OrderProduct {
  id: string;
  nameEn: string;
  nameUr: string | null;
  unit: ProductUnit;
  costPaisa: number;
}

export interface OrderLineDraft {
  key: string;
  productId: string;
  nameEn: string;
  nameUr: string | null;
  unit: ProductUnit;
  qtyText: string;
  costText: string;
}

export interface OrderFormValues {
  supplierId: string | null;
  notes: string;
  lines: OrderLineDraft[];
}

export interface OrderLineErrors {
  qty?: string;
  cost?: string;
}

export interface OrderFormErrors {
  supplier?: string;
  lines?: string;
  notes?: string;
  line: Record<string, OrderLineErrors>;
}

export const orderFormMessages = {
  supplier: "Pick a supplier.",
  noLines: "Add at least one line.",
  qtyEmpty: "Enter the quantity.",
  qtyWhole: "Enter a whole number of pieces.",
  qtyPositive: "Enter a quantity above 0.",
  qtyTooLarge: "Quantity is too large.",
  costInvalid: "Enter the cost in rupees.",
  costTooLarge: "Cost is too large.",
} as const;

export const ONE_UNIT_MILLI = 1000;

export const emptyOrderForm = (): OrderFormValues => ({ supplierId: null, notes: "", lines: [] });

const lineFrom = (product: OrderProduct, qtyText: string): OrderLineDraft => ({
  key: crypto.randomUUID(),
  productId: product.id,
  nameEn: product.nameEn,
  nameUr: product.nameUr,
  unit: product.unit,
  qtyText,
  costText: rupeeInputText(product.costPaisa),
});

export const formFromOrder = (order: PurchaseOrder): OrderFormValues => ({
  supplierId: order.supplierId,
  notes: order.notes ?? "",
  lines: order.lines.map((line) => ({
    key: crypto.randomUUID(),
    productId: line.productId,
    nameEn: line.nameEn,
    nameUr: line.nameUr,
    unit: line.unit,
    qtyText: quantityInputText(line.orderedQtyMilli, line.unit),
    costText: rupeeInputText(line.unitCostPaisa),
  })),
});

export function shortfallQtyText(item: Pick<LowStockItem, "shortfallMilli" | "unit">): string {
  if (item.shortfallMilli <= 0) return "";
  const milli =
    item.unit === "piece"
      ? Math.ceil(item.shortfallMilli / ONE_UNIT_MILLI) * ONE_UNIT_MILLI
      : item.shortfallMilli;
  return quantityInputText(milli, item.unit);
}

export const formFromLowStock = (items: readonly LowStockItem[]): OrderFormValues => ({
  supplierId: null,
  notes: "",
  lines: items.map((item) => lineFrom(item, shortfallQtyText(item))),
});

export interface AddResult {
  lines: OrderLineDraft[];
  key: string;
}

export function addProduct(
  lines: readonly OrderLineDraft[],
  product: OrderProduct,
  qtyMilli: number,
): AddResult {
  const existing = lines.find((line) => line.productId === product.id);
  if (!existing) {
    const added = lineFrom(product, qtyMilli > 0 ? quantityInputText(qtyMilli, product.unit) : "");
    return { lines: [...lines, added], key: added.key };
  }
  if (qtyMilli === 0) return { lines: [...lines], key: existing.key };
  const parsed = parseQuantityMilli(existing.qtyText, existing.unit);
  const current = parsed.ok ? parsed.milli : 0;
  const qtyText = quantityInputText(current + qtyMilli, existing.unit);
  return {
    lines: lines.map((line) => (line === existing ? { ...line, qtyText } : line)),
    key: existing.key,
  };
}

export function addFromLookup(
  lines: readonly OrderLineDraft[],
  lookup: BarcodeLookup,
): AddResult & { focus: "none" | "qty" } {
  if (lookup.source === "scale") {
    return { ...addProduct(lines, lookup.product, 0), focus: "qty" };
  }
  return { ...addProduct(lines, lookup.product, lookup.packQtyMilli), focus: "none" };
}

function lineInput(line: OrderLineDraft) {
  const qty = parseQuantityMilli(line.qtyText, line.unit);
  const cost = parseRupees(line.costText);
  if (!qty.ok || !cost.ok) return null;
  return { productId: line.productId, orderedQtyMilli: qty.milli, unitCostPaisa: cost.paisa };
}

export function lineTotal(line: OrderLineDraft): number | null {
  const input = lineInput(line);
  if (!input || !purchaseOrderLineInputSchema.safeParse(input).success) return null;
  return purchaseOrderLineTotalPaisa(input.orderedQtyMilli, input.unitCostPaisa);
}

export function orderTotal(lines: readonly OrderLineDraft[]): number {
  return lines.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0);
}

export const lineProjection = (line: OrderLineDraft) =>
  [line.productId, line.qtyText, line.costText] as const;

export function isOrderFormDirty(initial: OrderFormValues, current: OrderFormValues): boolean {
  return (
    initial.supplierId !== current.supplierId ||
    initial.notes !== current.notes ||
    JSON.stringify(initial.lines.map(lineProjection)) !==
      JSON.stringify(current.lines.map(lineProjection))
  );
}

export function quantityError(line: OrderLineDraft): string | null {
  if (line.qtyText.trim() === "") return orderFormMessages.qtyEmpty;
  const parsed = parseQuantityMilli(line.qtyText, line.unit);
  if (!parsed.ok) {
    return line.unit === "piece" ? orderFormMessages.qtyWhole : orderFormMessages.qtyPositive;
  }
  return parsed.milli === 0 ? orderFormMessages.qtyPositive : null;
}

export function costError(line: OrderLineDraft): string | null {
  return parseRupees(line.costText).ok ? null : orderFormMessages.costInvalid;
}

export function buildOrderPayload(
  values: OrderFormValues,
): { ok: true; payload: CreatePurchaseOrderInput } | { ok: false; errors: OrderFormErrors } {
  const errors: OrderFormErrors = { line: {} };
  if (values.supplierId === null) errors.supplier = orderFormMessages.supplier;
  if (values.lines.length === 0) errors.lines = orderFormMessages.noLines;
  for (const line of values.lines) {
    const qty = quantityError(line);
    const cost = costError(line);
    if (qty || cost) {
      errors.line[line.key] = { ...(qty ? { qty } : {}), ...(cost ? { cost } : {}) };
    }
  }
  const { supplierId } = values;
  if (supplierId === null || errors.lines || Object.keys(errors.line).length > 0) {
    return { ok: false, errors };
  }

  const payload: CreatePurchaseOrderInput = {
    supplierId,
    notes: values.notes,
    lines: values.lines.flatMap((line) => {
      const input = lineInput(line);
      return input ? [input] : [];
    }),
  };
  const parsed = createPurchaseOrderInputSchema.safeParse(payload);
  if (parsed.success) return { ok: true, payload };

  for (const issue of parsed.error.issues) {
    const [head, index, field] = issue.path;
    if (head === "notes") errors.notes ??= issue.message;
    else if (head === "lines" && typeof index === "number") {
      const key = values.lines[index]?.key;
      if (!key) continue;
      const entry = (errors.line[key] ??= {});
      if (field === "orderedQtyMilli") {
        entry.qty ??= issue.code === "custom" ? issue.message : orderFormMessages.qtyTooLarge;
      } else {
        entry.cost ??= issue.code === "custom" ? issue.message : orderFormMessages.costTooLarge;
      }
    } else if (head === "lines") errors.lines ??= issue.message;
  }
  return { ok: false, errors };
}
