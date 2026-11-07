import { describe, expect, it } from "vitest";

import type { PurchaseOrderSummary } from "@shared/purchase-orders";
import { filterOrders, supplierOptions } from "./order-list";

const order = (
  id: string,
  supplierId: string,
  supplierName: string,
  status: PurchaseOrderSummary["status"],
): PurchaseOrderSummary => ({
  id,
  orderNo: `PO-T1-${id}`,
  supplierId,
  supplierName,
  status,
  totalPaisa: 100,
  lineCount: 1,
  createdAt: "2026-03-05T10:00:00.000Z",
});

const orders = [
  order("1", "s2", "Rehman Traders", "draft"),
  order("2", "s1", "Al-Noor", "confirmed"),
  order("3", "s2", "Rehman Traders", "confirmed"),
  order("4", "s1", "Al-Noor", "cancelled"),
];

const ids = (list: PurchaseOrderSummary[]) => list.map((entry) => entry.id);

describe("filterOrders", () => {
  it("keeps everything with no filters", () => {
    expect(ids(filterOrders(orders, { supplierId: null, status: null }))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("filters by supplier", () => {
    expect(ids(filterOrders(orders, { supplierId: "s1", status: null }))).toEqual(["2", "4"]);
  });

  it("filters by status", () => {
    expect(ids(filterOrders(orders, { supplierId: null, status: "confirmed" }))).toEqual([
      "2",
      "3",
    ]);
  });

  it("combines both filters", () => {
    expect(ids(filterOrders(orders, { supplierId: "s2", status: "confirmed" }))).toEqual(["3"]);
    expect(filterOrders(orders, { supplierId: "s2", status: "cancelled" })).toEqual([]);
  });
});

describe("supplierOptions", () => {
  it("lists each supplier once, sorted by name", () => {
    expect(supplierOptions(orders)).toEqual([
      { id: "s1", name: "Al-Noor" },
      { id: "s2", name: "Rehman Traders" },
    ]);
  });

  it("is empty with no orders", () => {
    expect(supplierOptions([])).toEqual([]);
  });
});
