import { PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { Category } from "@shared/categories";
import type { TaxCategory } from "@shared/tax-categories";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import { CategoryNameDialog } from "./category-name-dialog";
import { categoryActions, taxCategoryActions } from "./category-actions";
import { DeleteCategoryDialog } from "./delete-category-dialog";
import { TaxCategoryDialog } from "./tax-category-dialog";
import { formatTaxRate } from "./tax-rate-input";

type DialogState =
  | { kind: "category"; category: Category | null; open: boolean }
  | { kind: "delete-category"; category: Category; open: boolean }
  | { kind: "tax-category"; taxCategory: TaxCategory | null; open: boolean }
  | { kind: "delete-tax-category"; taxCategory: TaxCategory; open: boolean }
  | null;

interface CategoriesScreenProps {
  onSessionEnded: () => void;
}

const sectionHeading =
  "m-0 text-[length:var(--font-size-550)] leading-[var(--line-height-tight)] font-semibold text-foreground";

function DefaultBadge() {
  return <Badge variant="neutral">Default</Badge>;
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-secondary">
        {children}
      </TableCell>
    </TableRow>
  );
}

export function CategoriesScreen({ onSessionEnded }: CategoriesScreenProps) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [taxCategories, setTaxCategories] = useState<TaxCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const setOpen = (open: boolean) =>
    setDialog((current) => (current ? { ...current, open } : null));

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  const refresh = useCallback(() => {
    Promise.all([window.vendora.categories.list(), window.vendora.taxCategories.list()])
      .then(([categoryRows, taxRows]) => {
        setCategories(categoryRows);
        setTaxCategories(taxRows);
        setError(null);
      })
      .catch(fail);
  }, [fail]);

  useEffect(refresh, [refresh]);

  const canAddCategory = categoryActions({ isSystem: false }).add;
  const canAddTaxCategory = taxCategoryActions({ isSystem: false }).add;
  const showTaxActions = canAddTaxCategory;
  const loaded = categories !== null && taxCategories !== null;

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Categories
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Group products, and set the tax each one uses.
        </p>
      </div>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      {!loaded ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading…</p>
        )
      ) : (
        <div className="grid grid-cols-2 items-start gap-800">
          <section aria-labelledby="categories-heading" className="flex flex-col gap-400">
            <div className="flex items-center gap-400">
              <h2 id="categories-heading" className={`${sectionHeading} flex-1`}>
                Categories
              </h2>
              {canAddCategory ? (
                <Button
                  autoFocus
                  onClick={() => setDialog({ kind: "category", category: null, open: true })}
                >
                  <PlusIcon aria-hidden="true" size={16} strokeWidth={2} />
                  Add category
                </Button>
              ) : null}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  {canAddCategory ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.length === 0 ? (
                  <EmptyRow colSpan={2}>No categories yet.</EmptyRow>
                ) : null}
                {categories.map((category) => {
                  const actions = categoryActions(category);
                  return (
                    <TableRow key={category.id}>
                      <TableCell>
                        <div className="flex items-center gap-200">
                          <span className="text-[length:var(--font-size-400)] text-foreground">
                            {category.name}
                          </span>
                          {category.isSystem ? <DefaultBadge /> : null}
                        </div>
                      </TableCell>
                      {canAddCategory ? (
                        <TableCell>
                          <div className="flex justify-end gap-200">
                            {actions.rename ? (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  setDialog({ kind: "category", category, open: true })
                                }
                              >
                                Rename
                              </Button>
                            ) : null}
                            {actions.remove ? (
                              <Button
                                variant="ghost"
                                className="text-critical"
                                onClick={() =>
                                  setDialog({ kind: "delete-category", category, open: true })
                                }
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
          <section aria-labelledby="tax-categories-heading" className="flex flex-col gap-400">
            <div className="flex items-center gap-400">
              <h2 id="tax-categories-heading" className={`${sectionHeading} flex-1`}>
                Tax categories
              </h2>
              {canAddTaxCategory ? (
                <Button
                  onClick={() => setDialog({ kind: "tax-category", taxCategory: null, open: true })}
                >
                  <PlusIcon aria-hidden="true" size={16} strokeWidth={2} />
                  Add tax category
                </Button>
              ) : null}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  {showTaxActions ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxCategories.length === 0 ? (
                  <EmptyRow colSpan={showTaxActions ? 3 : 2}>No tax categories yet.</EmptyRow>
                ) : null}
                {taxCategories.map((taxCategory) => {
                  const actions = taxCategoryActions(taxCategory);
                  return (
                    <TableRow key={taxCategory.id}>
                      <TableCell>
                        <div className="flex items-center gap-200">
                          <span className="text-[length:var(--font-size-400)] text-foreground">
                            {taxCategory.name}
                          </span>
                          {taxCategory.isSystem ? <DefaultBadge /> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTaxRate(taxCategory.rateBps)}
                      </TableCell>
                      {showTaxActions ? (
                        <TableCell>
                          <div className="flex justify-end gap-200">
                            {actions.edit ? (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  setDialog({ kind: "tax-category", taxCategory, open: true })
                                }
                              >
                                Edit
                              </Button>
                            ) : null}
                            {actions.remove ? (
                              <Button
                                variant="ghost"
                                className="text-critical"
                                onClick={() =>
                                  setDialog({
                                    kind: "delete-tax-category",
                                    taxCategory,
                                    open: true,
                                  })
                                }
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        </div>
      )}
      {dialog?.kind === "category" ? (
        <CategoryNameDialog
          category={dialog.category}
          open={dialog.open}
          onOpenChange={setOpen}
          onSaved={refresh}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {dialog?.kind === "delete-category" ? (
        <DeleteCategoryDialog
          title={`Delete category ${dialog.category.name}?`}
          open={dialog.open}
          remove={() => window.vendora.categories.remove(dialog.category.id)}
          onDeleted={refresh}
          onOpenChange={setOpen}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {dialog?.kind === "tax-category" ? (
        <TaxCategoryDialog
          taxCategory={dialog.taxCategory}
          open={dialog.open}
          onOpenChange={setOpen}
          onSaved={refresh}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {dialog?.kind === "delete-tax-category" ? (
        <DeleteCategoryDialog
          title={`Delete tax category ${dialog.taxCategory.name}?`}
          open={dialog.open}
          remove={() => window.vendora.taxCategories.remove(dialog.taxCategory.id)}
          onDeleted={refresh}
          onOpenChange={setOpen}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}
