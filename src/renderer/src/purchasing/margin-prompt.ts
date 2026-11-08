import type { LowMarginItem } from "@shared/goods-received";
import { parseRupees, rupeeInputText } from "@renderer/lib/money";
import { rateInputText } from "../categories/tax-rate-input";
import { amountMessage } from "../products/product-form";

export interface MarginRow {
  item: LowMarginItem;
  newPrice: string;
}

export interface PlannedChange {
  productId: string;
  salePricePaisa: number;
}

export function formatMarginBps(bps: number | null): string {
  if (bps === null) return "n/a";
  return `${bps < 0 ? "−" : ""}${rateInputText(Math.abs(bps))}%`;
}

export function initialRows(items: readonly LowMarginItem[]): MarginRow[] {
  return items.map((item) => ({ item, newPrice: rupeeInputText(item.salePricePaisa) }));
}

export function plannedChanges(rows: readonly MarginRow[]): {
  changes: PlannedChange[];
  errors: Record<string, string>;
} {
  const changes: PlannedChange[] = [];
  const errors: Record<string, string> = {};
  for (const { item, newPrice } of rows) {
    const parsed = parseRupees(newPrice);
    if (!parsed.ok) errors[item.productId] = amountMessage;
    else if (parsed.paisa !== item.salePricePaisa) {
      changes.push({ productId: item.productId, salePricePaisa: parsed.paisa });
    }
  }
  return { changes, errors };
}
