import type { VendoraApi } from "@shared/ipc";
import type {
  ProductSearchItem,
  ProductSearchQuery,
  ProductSearchResult,
  ProductUnit,
} from "@shared/products";

export const PRODUCT_PAGE_SIZE = 50;

export interface ProductFilters {
  query: string;
  categoryId: string | null;
  showArchived: boolean;
}

export function productSearchQuery(filters: ProductFilters, page: number): ProductSearchQuery {
  return {
    query: filters.query,
    ...(filters.categoryId === null ? {} : { categoryId: filters.categoryId }),
    includeArchived: filters.showArchived,
    limit: PRODUCT_PAGE_SIZE,
    offset: page * PRODUCT_PAGE_SIZE,
  };
}

export async function fetchProductPage(
  search: VendoraApi["products"]["search"],
  filters: ProductFilters,
  page: number,
): Promise<{ page: number; result: ProductSearchResult }> {
  const result = await search(productSearchQuery(filters, page));
  if (result.items.length === 0 && page > 0 && result.total > 0) {
    const lastPage = Math.ceil(result.total / PRODUCT_PAGE_SIZE) - 1;
    return { page: lastPage, result: await search(productSearchQuery(filters, lastPage)) };
  }
  return { page, result };
}

export function barcodeSummary(
  item: Pick<ProductSearchItem, "primaryBarcode" | "extraBarcodeCount">,
): {
  primary: string | null;
  extra: string | null;
} {
  return {
    primary: item.primaryBarcode,
    extra: item.extraBarcodeCount > 0 ? `+${item.extraBarcodeCount}` : null,
  };
}

const unitLabels: Record<ProductUnit, string> = { piece: "pcs", kg: "kg", litre: "L" };

export const unitLabel = (unit: ProductUnit): string => unitLabels[unit];

export const statusLabel = (isActive: boolean): string => (isActive ? "Active" : "Archived");

const grouped = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function pageRangeLabel(page: number, count: number, total: number): string {
  if (count === 0) return "Showing 0 of 0";
  const first = page * PRODUCT_PAGE_SIZE + 1;
  return `Showing ${grouped(first)}–${grouped(first + count - 1)} of ${grouped(total)}`;
}

export function emptyState(filters: ProductFilters): { title: string; text: string } {
  const query = filters.query.trim();
  if (query !== "") {
    return {
      title: `No products match "${query}"`,
      text: "Check the spelling, or search by barcode or code.",
    };
  }
  if (filters.categoryId === null && !filters.showArchived) {
    return { title: "No products yet", text: "Products you add show up here." };
  }
  return {
    title:
      filters.categoryId === null
        ? "No products match these filters"
        : "No products in this category",
    text: "Try changing the filters.",
  };
}

const typingSelector =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"], [role="listbox"]';

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target !== null && "closest" in target && (target as Element).closest(typingSelector) !== null
  );
}
