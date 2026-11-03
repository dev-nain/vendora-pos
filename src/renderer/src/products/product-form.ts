import type { Category } from "@shared/categories";
import type { VendoraApi } from "@shared/ipc";
import {
  createProductInputSchema,
  productMessages,
  type CreateProductInput,
  type Product,
  type ProductUnit,
  type UpdateProductResult,
} from "@shared/products";
import type { TaxCategory } from "@shared/tax-categories";
import { formatRupees, parseRupees, rupeeInputText } from "../lib/money";
import { parseQuantityMilli, quantityInputText } from "../lib/quantity";

export const unitOptions: { value: ProductUnit; label: string }[] = [
  { value: "piece", label: "Piece" },
  { value: "kg", label: "Kilogram" },
  { value: "litre", label: "Litre" },
];

export const MAX_BARCODE_ROWS = 50;

export interface BarcodeRowValues {
  key: string;
  barcode: string;
  packQty: string;
  packPrice: string;
}

export interface ProductFormValues {
  nameEn: string;
  nameUr: string;
  brand: string;
  internalCode: string;
  pctCode: string;
  cost: string;
  salePrice: string;
  mrp: string;
  lowStock: string;
  categoryId: string;
  taxCategoryId: string;
  unit: ProductUnit;
  isActive: boolean;
  barcodes: BarcodeRowValues[];
}

export type ProductField = Exclude<keyof ProductFormValues, "isActive" | "barcodes">;
export type BarcodeColumn = "barcode" | "packQty" | "packPrice";

export interface ProductFormErrors {
  fields: Partial<Record<ProductField, string>>;
  rows: Record<string, Partial<Record<BarcodeColumn, string>>>;
  form: string | null;
}

export type FocusTarget =
  | { kind: "field"; field: ProductField }
  | { kind: "row"; key: string; column: BarcodeColumn }
  | null;

export type ProductRefusal = Extract<UpdateProductResult, { ok: false }>;

const amountMessage = "Enter an amount in rupees, up to 2 decimals";
const packQtyMessage = "Pack quantity must be more than 0";

const quantityMessages: Record<ProductUnit, string> = {
  piece: "Enter a whole number of pieces",
  kg: "Enter a quantity in kg, up to 3 decimals",
  litre: "Enter a quantity in litres, up to 3 decimals",
};

const textFields = ["nameEn", "nameUr", "brand", "internalCode", "pctCode"] as const;

export const newBarcodeRow = (): BarcodeRowValues => ({
  key: crypto.randomUUID(),
  barcode: "",
  packQty: "1",
  packPrice: "",
});

export function emptyProductForm(
  categories: Category[],
  taxCategories: TaxCategory[],
): ProductFormValues {
  return {
    nameEn: "",
    nameUr: "",
    brand: "",
    internalCode: "",
    pctCode: "",
    cost: "",
    salePrice: "",
    mrp: "",
    lowStock: "",
    categoryId: categories.find((category) => category.isSystem)?.id ?? categories[0]?.id ?? "",
    taxCategoryId:
      taxCategories.find((tax) => tax.isSystem && tax.rateBps === null)?.id ??
      taxCategories[0]?.id ??
      "",
    unit: "piece",
    isActive: true,
    barcodes: [],
  };
}

export function formFromProduct(product: Product): ProductFormValues {
  return {
    nameEn: product.nameEn,
    nameUr: product.nameUr ?? "",
    brand: product.brand ?? "",
    internalCode: product.internalCode ?? "",
    pctCode: product.pctCode ?? "",
    cost: rupeeInputText(product.costPaisa),
    salePrice: rupeeInputText(product.salePricePaisa),
    mrp: product.mrpPaisa === null ? "" : rupeeInputText(product.mrpPaisa),
    lowStock:
      product.lowStockThresholdMilli === null
        ? ""
        : quantityInputText(product.lowStockThresholdMilli, product.unit),
    categoryId: product.categoryId,
    taxCategoryId: product.taxCategoryId,
    unit: product.unit,
    isActive: product.isActive,
    barcodes: product.barcodes.map((entry) => ({
      key: crypto.randomUUID(),
      barcode: entry.barcode,
      packQty: quantityInputText(entry.packQtyMilli, product.unit),
      packPrice: entry.salePricePaisa === null ? "" : rupeeInputText(entry.salePricePaisa),
    })),
  };
}

export const isFormDirty = (initial: ProductFormValues, current: ProductFormValues): boolean =>
  JSON.stringify(initial) !== JSON.stringify(current);

const optionalText = (text: string): string | null => {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
};

function textIssueMessage(field: ProductField, issue: { code: string; maximum?: unknown }): string {
  if (field === "nameEn" && issue.code === "too_small") return "Enter the product name";
  if (issue.code === "too_big") return `Keep this under ${String(issue.maximum)} characters`;
  return "Check this value";
}

export function buildProductPayload(
  values: ProductFormValues,
): { ok: true; payload: CreateProductInput } | { ok: false; errors: ProductFormErrors } {
  const errors: ProductFormErrors = { fields: {}, rows: {}, form: null };
  const rowError = (key: string, column: BarcodeColumn, message: string) => {
    errors.rows[key] = { ...errors.rows[key], [column]: message };
  };

  const money = (field: "cost" | "salePrice"): number => {
    const parsed = parseRupees(values[field]);
    if (parsed.ok) return parsed.paisa;
    errors.fields[field] = amountMessage;
    return 0;
  };
  const costPaisa = money("cost");
  const salePricePaisa = money("salePrice");

  let mrpPaisa: number | null = null;
  if (values.mrp.trim() !== "") {
    const parsed = parseRupees(values.mrp);
    if (parsed.ok) mrpPaisa = parsed.paisa;
    else errors.fields.mrp = amountMessage;
  }

  let lowStockThresholdMilli: number | null = null;
  if (values.lowStock.trim() !== "") {
    const parsed = parseQuantityMilli(values.lowStock, values.unit);
    if (parsed.ok) lowStockThresholdMilli = parsed.milli;
    else errors.fields.lowStock = quantityMessages[values.unit];
  }

  const keptRows = values.barcodes.filter((row) => row.barcode.trim() !== "");
  const barcodes = keptRows.map((row) => {
    let packQtyMilli = 1000;
    const qty = parseQuantityMilli(row.packQty, values.unit);
    if (!qty.ok) rowError(row.key, "packQty", quantityMessages[values.unit]);
    else if (qty.milli <= 0) rowError(row.key, "packQty", packQtyMessage);
    else packQtyMilli = qty.milli;

    let packPrice: number | null = null;
    if (row.packPrice.trim() !== "") {
      const price = parseRupees(row.packPrice);
      if (price.ok) packPrice = price.paisa;
      else rowError(row.key, "packPrice", amountMessage);
    }
    return { barcode: row.barcode.trim(), packQtyMilli, salePricePaisa: packPrice };
  });

  const payload: CreateProductInput = {
    nameEn: values.nameEn.trim(),
    nameUr: optionalText(values.nameUr),
    categoryId: values.categoryId,
    taxCategoryId: values.taxCategoryId,
    brand: optionalText(values.brand),
    unit: values.unit,
    internalCode: optionalText(values.internalCode),
    costPaisa,
    salePricePaisa,
    mrpPaisa,
    pctCode: optionalText(values.pctCode),
    lowStockThresholdMilli,
    barcodes,
  };

  const parsed = createProductInputSchema.safeParse(payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [head, index, column] = issue.path;
      if (head === "barcodes" && typeof index === "number" && column === "barcode") {
        const row = keptRows[index];
        if (row && !errors.rows[row.key]?.barcode) rowError(row.key, "barcode", issue.message);
      } else if (head === "mrpPaisa") {
        errors.fields.mrp ??= issue.message;
      } else if (head === "categoryId") {
        errors.fields.categoryId ??= "Pick a category";
      } else if (head === "taxCategoryId") {
        errors.fields.taxCategoryId ??= "Pick a tax category";
      } else if (textFields.some((field) => field === head)) {
        const field = head as (typeof textFields)[number];
        errors.fields[field] ??= textIssueMessage(
          field,
          issue as { code: string; maximum?: unknown },
        );
      } else {
        errors.form ??= issue.message;
      }
    }
  }

  const failed =
    Object.keys(errors.fields).length > 0 ||
    Object.keys(errors.rows).length > 0 ||
    errors.form !== null;
  return failed ? { ok: false, errors } : { ok: true, payload };
}

export function refusalErrors(
  refusal: ProductRefusal,
  values: ProductFormValues,
): { errors: ProductFormErrors; focus: FocusTarget } {
  const errors: ProductFormErrors = { fields: {}, rows: {}, form: null };
  const onField = (field: ProductField) => {
    errors.fields[field] = refusal.message;
    return { errors, focus: { kind: "field", field } satisfies FocusTarget };
  };

  switch (refusal.reason) {
    case "internal-code-taken":
      return onField("internalCode");
    case "category-not-found":
      return onField("categoryId");
    case "tax-category-not-found":
      return onField("taxCategoryId");
    case "barcode-taken": {
      const row = values.barcodes.find((entry) => {
        const barcode = entry.barcode.trim();
        return barcode !== "" && refusal.message.startsWith(barcodeTakenPrefix(barcode));
      });
      if (row) {
        errors.rows[row.key] = { barcode: refusal.message };
        return { errors, focus: { kind: "row", key: row.key, column: "barcode" } };
      }
      break;
    }
    case "not-found":
      break;
  }
  errors.form = refusal.message;
  return { errors, focus: null };
}

function barcodeTakenPrefix(barcode: string): string {
  const message = productMessages.barcodeTaken(barcode, "");
  const marker = " already belongs to ";
  return message.slice(0, message.indexOf(marker) + marker.length);
}

const hintFallback = "Unit price × qty";

export function packPriceHint(
  salePriceText: string,
  packQtyText: string,
  unit: ProductUnit,
): string {
  const price = parseRupees(salePriceText);
  const qty = parseQuantityMilli(packQtyText, unit);
  if (!price.ok || !qty.ok || qty.milli <= 0) return hintFallback;
  const product = price.paisa * qty.milli;
  if (!Number.isSafeInteger(product)) return hintFallback;
  return formatRupees(Math.floor((product + 500) / 1000));
}

type ProductsApi = Pick<VendoraApi["products"], "create" | "update" | "archive" | "restore">;

export async function saveProduct(
  api: ProductsApi,
  productId: string | null,
  payload: CreateProductInput,
  isActive: boolean,
): Promise<{ ok: true; product: Product; statusError: string | null } | ProductRefusal> {
  const saved = productId
    ? await api.update({ ...payload, id: productId })
    : await api.create(payload);
  if (!saved.ok) return saved;
  if (saved.product.isActive === isActive) {
    return { ok: true, product: saved.product, statusError: null };
  }
  const outcome = isActive
    ? await api.restore(saved.product.id)
    : await api.archive(saved.product.id);
  return outcome.ok
    ? { ok: true, product: outcome.product, statusError: null }
    : { ok: true, product: saved.product, statusError: outcome.message };
}
