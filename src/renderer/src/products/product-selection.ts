import { BULK_UPDATE_MAX_IDS, type ProductSearchItem } from "@shared/products";

export type Selection<T extends { id: string } = ProductSearchItem> = ReadonlyMap<string, T>;
export type PageState = "none" | "some" | "all";

export function toggleOne<T extends { id: string }>(
  selection: Selection<T>,
  item: T,
  limit = BULK_UPDATE_MAX_IDS,
): { selection: Selection<T>; capped: boolean } {
  const next = new Map(selection);
  if (next.delete(item.id)) return { selection: next, capped: false };
  if (next.size >= limit) return { selection, capped: true };
  next.set(item.id, item);
  return { selection: next, capped: false };
}

export function setPage<T extends { id: string }>(
  selection: Selection<T>,
  pageItems: readonly T[],
  checked: boolean,
  limit = BULK_UPDATE_MAX_IDS,
): { selection: Selection<T>; capped: boolean } {
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

export function pageState<T extends { id: string }>(
  selection: Selection<T>,
  pageItems: readonly T[],
): PageState {
  const selected = pageItems.filter((item) => selection.has(item.id)).length;
  if (selected === 0) return "none";
  return selected === pageItems.length ? "all" : "some";
}
