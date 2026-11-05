import type { OrderSummary, SalesListQuery } from "@shared/sales";

export function searchQueryFrom(text: string): SalesListQuery | null {
  const invoiceNo = text.trim();
  return invoiceNo === "" ? null : { invoiceNo: invoiceNo.slice(0, 32) };
}

export function dateQueryFrom(text: string): SalesListQuery | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { date: text } : null;
}

export function selectAfterSearch(orders: readonly OrderSummary[]): string | null {
  return orders[0]?.id ?? null;
}

export function moveOrderSelection(
  orders: readonly OrderSummary[],
  selectedId: string | null,
  direction: 1 | -1,
): string | null {
  if (orders.length === 0) return null;
  const index = orders.findIndex((order) => order.id === selectedId);
  if (index === -1) return orders[0]?.id ?? null;
  const next = Math.min(orders.length - 1, Math.max(0, index + direction));
  return orders[next]?.id ?? null;
}
