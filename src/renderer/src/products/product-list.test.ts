import { describe, expect, it } from "vitest";
import type { ProductSearchQuery, ProductSearchResult } from "@shared/products";
import {
  barcodeSummary,
  emptyState,
  exportStatusMessage,
  fetchProductPage,
  pageRangeLabel,
  statusLabel,
  unitLabel,
  type ProductFilters,
} from "./product-list";

const categoryId = "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";
const filters: ProductFilters = { query: "tapal", categoryId, showArchived: false };

const fakeSearch = (results: ProductSearchResult[]) => {
  const calls: ProductSearchQuery[] = [];
  const search = async (input: ProductSearchQuery) => {
    calls.push(input);
    return results[Math.min(calls.length, results.length) - 1]!;
  };
  return { calls, search };
};

const item = (id: string): ProductSearchResult["items"][number] => ({
  id,
  nameEn: id,
  nameUr: null,
  internalCode: null,
  categoryId,
  unit: "piece",
  salePricePaisa: 100,
  isActive: true,
  primaryBarcode: null,
  extraBarcodeCount: 0,
  onHandMilli: 0,
});

describe("fetchProductPage", () => {
  it("sends the query, category and page offset to the API", async () => {
    const { calls, search } = fakeSearch([{ items: [item("a")], total: 120 }]);
    const { page } = await fetchProductPage(search, filters, 1);
    expect(page).toBe(1);
    expect(calls).toEqual([
      { query: "tapal", categoryId, includeArchived: false, limit: 50, offset: 50 },
    ]);
  });

  it("omits categoryId when there is no category", async () => {
    const { calls, search } = fakeSearch([{ items: [], total: 0 }]);
    await fetchProductPage(search, { ...filters, categoryId: null }, 0);
    expect(calls[0]).not.toHaveProperty("categoryId");
  });

  it("passes the archived toggle through", async () => {
    const { calls, search } = fakeSearch([{ items: [], total: 0 }]);
    await fetchProductPage(search, { ...filters, showArchived: true }, 0);
    await fetchProductPage(search, { ...filters, showArchived: false }, 0);
    expect(calls.map((call) => call.includeArchived)).toEqual([true, false]);
  });

  it("steps back to the last page when the page is past the end", async () => {
    const { calls, search } = fakeSearch([
      { items: [], total: 120 },
      { items: [item("a")], total: 120 },
    ]);
    const fetched = await fetchProductPage(search, filters, 3);
    expect(fetched.page).toBe(2);
    expect(fetched.result.items).toHaveLength(1);
    expect(calls.map((call) => call.offset)).toEqual([150, 100]);
  });

  it("does not refetch an empty catalog", async () => {
    const { calls, search } = fakeSearch([{ items: [], total: 0 }]);
    const fetched = await fetchProductPage(search, filters, 2);
    expect(fetched.page).toBe(2);
    expect(calls).toHaveLength(1);
  });
});

describe("barcodeSummary", () => {
  it("shows the primary barcode with a +N count", () => {
    expect(barcodeSummary({ primaryBarcode: "8964000123459", extraBarcodeCount: 2 })).toEqual({
      primary: "8964000123459",
      extra: "+2",
    });
  });

  it("shows no count for a single barcode", () => {
    expect(barcodeSummary({ primaryBarcode: "8964000123459", extraBarcodeCount: 0 }).extra).toBe(
      null,
    );
  });

  it("handles a product with no barcode", () => {
    expect(barcodeSummary({ primaryBarcode: null, extraBarcodeCount: 0 })).toEqual({
      primary: null,
      extra: null,
    });
  });
});

describe("labels", () => {
  it("shortens units", () => {
    expect([unitLabel("piece"), unitLabel("kg"), unitLabel("litre")]).toEqual(["pcs", "kg", "L"]);
  });

  it("names the status in words", () => {
    expect([statusLabel(true), statusLabel(false)]).toEqual(["Active", "Archived"]);
  });

  it("describes the page range", () => {
    expect(pageRangeLabel(1, 50, 30000)).toBe("Showing 51–100 of 30,000");
    expect(pageRangeLabel(0, 0, 0)).toBe("Showing 0 of 0");
  });
});

describe("emptyState", () => {
  const base: ProductFilters = { query: "", categoryId: null, showArchived: false };

  it("invites the first product when nothing is filtered", () => {
    expect(emptyState(base)).toEqual({
      title: "No products yet",
      text: "Products you add show up here.",
    });
  });

  it("quotes the query", () => {
    expect(emptyState({ ...base, query: "zzz" })).toEqual({
      title: 'No products match "zzz"',
      text: "Check the spelling, or search by barcode or code.",
    });
  });

  it("names a category-only filter", () => {
    expect(emptyState({ ...base, categoryId }).title).toBe("No products in this category");
  });

  it("names an archived-only filter", () => {
    expect(emptyState({ ...base, showArchived: true }).title).toBe(
      "No products match these filters",
    );
  });
});

describe("exportStatusMessage", () => {
  it("names the saved path", () => {
    expect(exportStatusMessage({ status: "saved", path: "C:\\x\\a.csv" })).toBe(
      "Catalog exported to C:\\x\\a.csv.",
    );
  });

  it("is silent when cancelled", () => {
    expect(exportStatusMessage({ status: "cancelled" })).toBeNull();
  });
});
