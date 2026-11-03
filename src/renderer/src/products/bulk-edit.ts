import {
  adjustPricePaisa,
  productMessages,
  type BulkProductChange,
  type ProductSearchItem,
} from "@shared/products";
import { formatRupees, parseRupees } from "../lib/money";

export type BulkEditMode = "percent" | "price" | "category";

export interface BulkEditForm {
  mode: BulkEditMode;
  percent: string;
  price: string;
  categoryId: string | null;
}

export interface PreviewRow {
  id: string;
  nameEn: string;
  before: string;
  after: string;
}

export const PREVIEW_ROW_LIMIT = 5;

const percentPattern = /^([+-])?(\d{1,4})(?:\.(\d{1,2}))?$/;

export function parsePercent(
  text: string,
): { ok: true; bps: number } | { ok: false; message: string } {
  const match = percentPattern.exec(text.trim());
  if (!match) return { ok: false, message: productMessages.bulkPercentRange };
  const magnitude = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  const bps = match[1] === "-" ? -magnitude : magnitude;
  if (bps === 0 || bps <= -10000 || bps > 100000) {
    return { ok: false, message: productMessages.bulkPercentRange };
  }
  return { ok: true, bps };
}

export function buildChange(form: BulkEditForm): BulkProductChange | { error: string | null } {
  if (form.mode === "category") {
    return form.categoryId === null
      ? { error: null }
      : { kind: "category", categoryId: form.categoryId };
  }
  if (form.mode === "price") {
    if (form.price.trim() === "") return { error: null };
    const parsed = parseRupees(form.price);
    return parsed.ok
      ? { kind: "set-price", salePricePaisa: parsed.paisa }
      : { error: "Enter an amount like 150 or 150.50" };
  }
  if (form.percent.trim() === "") return { error: null };
  const parsed = parsePercent(form.percent);
  return parsed.ok ? { kind: "adjust-price", bps: parsed.bps } : { error: parsed.message };
}

export function previewRows(
  items: readonly ProductSearchItem[],
  change: BulkProductChange,
  categoryNames: ReadonlyMap<string, string>,
  limit = PREVIEW_ROW_LIMIT,
): { changing: number; total: number; rows: PreviewRow[] } {
  const changes: PreviewRow[] = [];
  let changing = 0;
  for (const item of items) {
    let row: Omit<PreviewRow, "id" | "nameEn"> | null = null;
    if (change.kind === "category") {
      if (item.categoryId !== change.categoryId) {
        row = {
          before: categoryNames.get(item.categoryId) ?? "—",
          after: categoryNames.get(change.categoryId) ?? "—",
        };
      }
    } else {
      const next =
        change.kind === "set-price"
          ? change.salePricePaisa
          : adjustPricePaisa(item.salePricePaisa, change.bps);
      if (next !== item.salePricePaisa) {
        row = { before: formatRupees(item.salePricePaisa), after: formatRupees(next) };
      }
    }
    if (!row) continue;
    changing += 1;
    if (changes.length < limit) changes.push({ id: item.id, nameEn: item.nameEn, ...row });
  }
  return { changing, total: items.length, rows: changes };
}
