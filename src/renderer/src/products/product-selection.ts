import { BULK_UPDATE_MAX_IDS, type ProductSearchItem } from "@shared/products";

export type Selection = ReadonlyMap<string, ProductSearchItem>;
export type PageState = "none" | "some" | "all";

export function toggleOne(
  selection: Selection,
  item: ProductSearchItem,
  limit = BULK_UPDATE_MAX_IDS,
): { selection: Selection; capped: boolean } {
  const next = new Map(selection);
  if (next.delete(item.id)) return { selection: next, capped: false };
  if (next.size >= limit) return { selection, capped: true };
  next.set(item.id, item);
  return { selection: next, capped: false };
}

export function setPage(
  selection: Selection,
  pageItems: readonly ProductSearchItem[],
  checked: boolean,
  limit = BULK_UPDATE_MAX_IDS,
): { selection: Selection; capped: boolean } {
  const next = new Map(selection);
  let capped = false;
  for (const item of pageItems) {
    if (!checked) {
      next.delete(item.id);
    } else if (next.has(item.id)) {
      next.set(item.id, item);
    } else if (next.size >= limit) {
      capped = true;
    } else {
      next.set(item.id, item);
    }
  }
  return { selection: next, capped };
}

export function pageState(
  selection: Selection,
  pageItems: readonly ProductSearchItem[],
): PageState {
  const selected = pageItems.filter((item) => selection.has(item.id)).length;
  if (selected === 0) return "none";
  return selected === pageItems.length ? "all" : "some";
}
