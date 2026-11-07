import {
  postPurchaseReturnInputSchema,
  type PostPurchaseReturnInput,
  type PurchaseReturnReason,
  type PurchaseReturnableNote,
  type PurchaseReturnableResult,
} from "@shared/purchase-returns";
import { rupeeInputText } from "../lib/money";
import { formatQuantity, parseQuantityMilli, quantityInputText } from "../lib/quantity";
import {
  lineProjection,
  orderFormMessages,
  orderTotal,
  quantityError,
  type OrderLineDraft,
  type OrderLineErrors,
} from "./order-form";

export interface ReturnLineDraft extends OrderLineDraft {
  goodsReceivedLineId: string | null;
  returnableQtyMilli: number;
}

export type ReturnSource = { kind: "supplier" } | { kind: "note"; note: PurchaseReturnableNote };

export interface ReturnFormValues {
  supplierId: string | null;
  reason: PurchaseReturnReason | null;
  notes: string;
  lines: ReturnLineDraft[];
}

export interface ReturnFormErrors {
  supplier?: string;
  reason?: string;
  notes?: string;
  lines?: string;
  line: Record<string, OrderLineErrors>;
}

export type ReturnScanMatch =
  | { kind: "existing"; key: string }
  | { kind: "new" }
  | { kind: "not-on-note" };

export interface SupplierReturnAdd {
  lines: ReturnLineDraft[];
  key: string;
}

export const returnFormMessages = {
  reason: "Pick a reason.",
  noNoteQuantities: "Enter a quantity on at least one line.",
} as const;

export const emptyReturnForm = (): ReturnFormValues => ({
  supplierId: null,
  reason: null,
  notes: "",
  lines: [],
});

export const returnFormFromNote = (result: PurchaseReturnableNote): ReturnFormValues => ({
  supplierId: result.note.supplierId,
  reason: null,
  notes: "",
  lines: result.lines
    .filter((line) => line.returnableQtyMilli > 0)
    .map((line) => ({
      key: crypto.randomUUID(),
      productId: line.productId,
      nameEn: line.nameEn,
      nameUr: line.nameUr,
      unit: line.unit,
      qtyText: "0",
      costText: rupeeInputText(line.unitCostPaisa),
      goodsReceivedLineId: line.goodsReceivedLineId,
      returnableQtyMilli: line.returnableQtyMilli,
    })),
});

export function matchReturnScan(
  lines: readonly ReturnLineDraft[],
  source: ReturnSource,
  productId: string,
): ReturnScanMatch {
  const inForm = lines.find((line) => line.productId === productId);
  if (inForm) return { kind: "existing", key: inForm.key };
  return source.kind === "supplier" ? { kind: "new" } : { kind: "not-on-note" };
}

export function addSupplierLine(
  lines: readonly ReturnLineDraft[],
  returnable: Extract<PurchaseReturnableResult, { ok: true }>,
  qtyMilli: number,
): SupplierReturnAdd {
  const { product } = returnable;
  const added: ReturnLineDraft = {
    key: crypto.randomUUID(),
    productId: product.id,
    nameEn: product.nameEn,
    nameUr: product.nameUr,
    unit: product.unit,
    qtyText: qtyMilli > 0 ? quantityInputText(qtyMilli, product.unit) : "",
    costText: rupeeInputText(returnable.unitCostPaisa),
    goodsReceivedLineId: null,
    returnableQtyMilli: returnable.returnableQtyMilli,
  };
  return { lines: [...lines, added], key: added.key };
}

export const returnTotal = (lines: readonly OrderLineDraft[]): number => orderTotal(lines);

export function isReturnFormDirty(initial: ReturnFormValues, current: ReturnFormValues): boolean {
  return (
    initial.supplierId !== current.supplierId ||
    initial.reason !== current.reason ||
    initial.notes !== current.notes ||
    JSON.stringify(initial.lines.map(lineProjection)) !==
      JSON.stringify(current.lines.map(lineProjection))
  );
}

interface PayloadLine {
  draft: ReturnLineDraft;
  qtyMilli: number;
}

export function buildReturnPayload(
  source: ReturnSource,
  values: ReturnFormValues,
): { ok: true; payload: PostPurchaseReturnInput } | { ok: false; errors: ReturnFormErrors } {
  const errors: ReturnFormErrors = { line: {} };
  const isNote = source.kind === "note";
  if (!isNote && values.supplierId === null) errors.supplier = orderFormMessages.supplier;
  if (values.reason === null) errors.reason = returnFormMessages.reason;

  const kept: PayloadLine[] = [];
  for (const draft of values.lines) {
    const parsed = parseQuantityMilli(draft.qtyText, draft.unit);
    if (isNote && parsed.ok && parsed.milli === 0) continue;
    const problem =
      quantityError(draft) ??
      (parsed.ok && parsed.milli > draft.returnableQtyMilli
        ? `Only ${formatQuantity(draft.returnableQtyMilli, draft.unit)} left to return.`
        : null);
    if (problem) {
      errors.line[draft.key] = { qty: problem };
      continue;
    }
    if (parsed.ok) kept.push({ draft, qtyMilli: parsed.milli });
  }
  if (kept.length === 0 && Object.keys(errors.line).length === 0) {
    errors.lines = isNote ? returnFormMessages.noNoteQuantities : orderFormMessages.noLines;
  }

  const hasErrors =
    errors.supplier ||
    errors.reason ||
    errors.notes ||
    errors.lines ||
    Object.keys(errors.line).length > 0;
  if (hasErrors) return { ok: false, errors };

  const reason = values.reason!;
  const payload: PostPurchaseReturnInput = isNote
    ? {
        kind: "note",
        goodsReceivedNoteId: source.note.note.id,
        reason,
        notes: values.notes,
        lines: kept.map(({ draft, qtyMilli }) => ({
          goodsReceivedLineId: draft.goodsReceivedLineId!,
          qtyMilli,
        })),
      }
    : {
        kind: "supplier",
        supplierId: values.supplierId!,
        reason,
        notes: values.notes,
        lines: kept.map(({ draft, qtyMilli }) => ({ productId: draft.productId, qtyMilli })),
      };

  const parsed = postPurchaseReturnInputSchema.safeParse(payload);
  if (parsed.success) return { ok: true, payload };

  for (const issue of parsed.error.issues) {
    const [head, index] = issue.path;
    if (head === "notes") errors.notes ??= issue.message;
    else if (head === "lines" && typeof index === "number") {
      const key = kept[index]?.draft.key;
      if (key) (errors.line[key] ??= {}).qty ??= orderFormMessages.qtyTooLarge;
    } else if (head === "lines") errors.lines ??= issue.message;
  }
  return { ok: false, errors };
}
