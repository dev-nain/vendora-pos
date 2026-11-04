import type { Category, DeleteCategoryResult } from "../../../shared/categories";
import type { DeleteTaxCategoryResult, TaxCategory } from "../../../shared/tax-categories";

export function categoryActions(category: Pick<Category, "isSystem">) {
  return { add: true, rename: true, remove: !category.isSystem };
}

export function taxCategoryActions(taxCategory: Pick<TaxCategory, "isSystem">) {
  return {
    add: true,
    edit: true,
    remove: !taxCategory.isSystem,
    canEditRate: !taxCategory.isSystem,
  };
}

export function deleteRefusalMessage(
  result: DeleteCategoryResult | DeleteTaxCategoryResult,
): string | null {
  return result.ok ? null : result.message;
}
