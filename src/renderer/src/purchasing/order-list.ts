import type { PurchaseOrderStatus, PurchaseOrderSummary } from "@shared/purchase-orders";

export interface OrderFilters {
  supplierId: string | null;
  status: PurchaseOrderStatus | null;
}

export function filterOrders(
  orders: readonly PurchaseOrderSummary[],
  { supplierId, status }: OrderFilters,
): PurchaseOrderSummary[] {
  return orders.filter(
    (order) =>
      (supplierId === null || order.supplierId === supplierId) &&
      (status === null || order.status === status),
  );
}

export function supplierOptions(
  orders: readonly PurchaseOrderSummary[],
): { id: string; name: string }[] {
  const byId = new Map(orders.map((order) => [order.supplierId, order.supplierName]));
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
