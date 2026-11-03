import type { Category, DeleteCategoryResult } from "../../../shared/categories";
import type { SafeUser } from "@shared/auth";
import { hasPermission } from "../../../shared/permissions";
import type { DeleteTaxCategoryResult, TaxCategory } from "../../../shared/tax-categories";

type Role = SafeUser["role"];

export function categoryActions(role: Role, category: Pick<Category, "isSystem">) {
  const allowed = hasPermission(role, "products.manage");
  return { add: allowed, rename: allowed, remove: allowed && !category.isSystem };
}

export function taxCategoryActions(role: Role, taxCategory: Pick<TaxCategory, "isSystem">) {
  const allowed = hasPermission(role, "settings.manage");
  return {
    add: allowed,
    edit: allowed,
    remove: allowed && !taxCategory.isSystem,
    canEditRate: !taxCategory.isSystem,
  };
}

export function deleteRefusalMessage(
  result: DeleteCategoryResult | DeleteTaxCategoryResult,
): string | null {
  return result.ok ? null : result.message;
}
