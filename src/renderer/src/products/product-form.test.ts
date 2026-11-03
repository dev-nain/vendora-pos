import { describe, expect, it, vi } from "vitest";

import { productMessages, type Product } from "@shared/products";
import {
  buildProductPayload,
  emptyProductForm,
  formFromProduct,
  isFormDirty,
  newBarcodeRow,
  packPriceHint,
  refusalErrors,
  saveProduct,
  type ProductFormValues,
  type ProductRefusal,
} from "./product-form";

const categoryId = "0190a000-0000-7000-8000-000000000001";
const taxCategoryId = "0190a000-0000-7000-8000-000000000002";
const productId = "0190a000-0000-7000-8000-000000000003";

const row = (barcode: string, packQty = "1", packPrice = "") => ({
  ...newBarcodeRow(),
  barcode,
  packQty,
  packPrice,
});

const filled = (overrides: Partial<ProductFormValues> = {}): ProductFormValues => ({
  nameEn: "  Tapal Danedar 950g ",
  nameUr: " ٹپال ",
  brand: "",
  internalCode: "TD-950",
  pctCode: "",
  cost: "1120",
  salePrice: "1250.5",
  mrp: "",
  lowStock: "",
  categoryId,
  taxCategoryId,
  unit: "piece",
  isActive: true,
  barcodes: [],
  ...overrides,
});

const product = (overrides: Partial<Product> = {}): Product => ({
  id: productId,
  nameEn: "Sugar",
  nameUr: null,
  categoryId,
  taxCategoryId,
  brand: null,
  unit: "kg",
  internalCode: "SUG-01",
  costPaisa: 14800,
  salePricePaisa: 16050,
  mrpPaisa: null,
  pctCode: null,
  lowStockThresholdMilli: 25500,
  isActive: true,
  barcodes: [{ barcode: "8964000123459", packQtyMilli: 500, salePricePaisa: 9000 }],
  ...overrides,
});

const refusal = (reason: ProductRefusal["reason"], message: string): ProductRefusal => ({
  ok: false,
  reason,
  message,
});

const fakeApi = (saved: Product = product()) => ({
  create: vi.fn(async () => ({ ok: true as const, product: saved })),
  update: vi.fn(async () => ({ ok: true as const, product: saved })),
  archive: vi.fn(async () => ({ ok: true as const, product: { ...saved, isActive: false } })),
  restore: vi.fn(async () => ({ ok: true as const, product: { ...saved, isActive: true } })),
});

describe("emptyProductForm", () => {
  it("defaults to the system category and Standard tax", () => {
    const form = emptyProductForm(
      [
        { id: "a", name: "Dairy", isSystem: false },
        { id: "b", name: "General", isSystem: true },
      ],
      [
        { id: "x", name: "Exempt", rateBps: 0, isSystem: true },
        { id: "y", name: "Standard", rateBps: null, isSystem: true },
      ],
    );
    expect(form).toMatchObject({ categoryId: "b", taxCategoryId: "y", unit: "piece" });
    expect(form.isActive).toBe(true);
    expect(form.barcodes).toEqual([]);
  });
});

describe("buildProductPayload", () => {
  it("builds the exact payload", () => {
    const result = buildProductPayload(
      filled({
        mrp: "1300",
        lowStock: "6",
        barcodes: [
          row("8964000123459"),
          row("8964000123466", "12", "1450"),
          row("  ", "5", "9"),
          row("8964000123473", "24"),
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      payload: {
        nameEn: "Tapal Danedar 950g",
        nameUr: "ٹپال",
        categoryId,
        taxCategoryId,
        brand: null,
        unit: "piece",
        internalCode: "TD-950",
        costPaisa: 112000,
        salePricePaisa: 125050,
        mrpPaisa: 130000,
        pctCode: null,
        lowStockThresholdMilli: 6000,
        barcodes: [
          { barcode: "8964000123459", packQtyMilli: 1000, salePricePaisa: null },
          { barcode: "8964000123466", packQtyMilli: 12000, salePricePaisa: 145000 },
          { barcode: "8964000123473", packQtyMilli: 24000, salePricePaisa: null },
        ],
      },
    });
  });

  it("nulls blank MRP and low stock", () => {
    const result = buildProductPayload(filled());
    expect(result.ok && result.payload).toMatchObject({
      mrpPaisa: null,
      lowStockThresholdMilli: null,
    });
  });

  it("flags MRP below the sale price", () => {
    const result = buildProductPayload(filled({ salePrice: "145", mrp: "140" }));
    expect(!result.ok && result.errors.fields.mrp).toBe(productMessages.mrpBelowSalePrice);
  });

  it("flags a repeated barcode on the second row", () => {
    const second = row("111");
    const result = buildProductPayload(filled({ barcodes: [row("111"), second] }));
    expect(!result.ok && result.errors.rows[second.key]?.barcode).toBe(
      productMessages.duplicateBarcode,
    );
  });

  it("flags a fractional pack quantity for pieces only", () => {
    const entry = row("111", "1.5");
    const piece = buildProductPayload(filled({ barcodes: [entry] }));
    expect(!piece.ok && piece.errors.rows[entry.key]?.packQty).toBeDefined();
    expect(buildProductPayload(filled({ unit: "kg", barcodes: [entry] })).ok).toBe(true);
  });

  it("flags a zero pack quantity", () => {
    const entry = row("111", "0");
    const result = buildProductPayload(filled({ barcodes: [entry] }));
    expect(!result.ok && result.errors.rows[entry.key]?.packQty).toBe(
      "Pack quantity must be more than 0",
    );
  });

  it("flags an empty name", () => {
    const result = buildProductPayload(filled({ nameEn: "  " }));
    expect(!result.ok && result.errors.fields.nameEn).toBe("Enter the product name");
  });

  it("flags an invalid cost", () => {
    const result = buildProductPayload(filled({ cost: "1.234" }));
    expect(!result.ok && result.errors.fields.cost).toBe(
      "Enter an amount in rupees, up to 2 decimals",
    );
  });

  it("flags a barcode with spaces on its row", () => {
    const entry = row("12 34");
    const result = buildProductPayload(filled({ barcodes: [entry] }));
    expect(!result.ok && result.errors.rows[entry.key]?.barcode).toBe(
      "Barcode can't contain spaces",
    );
  });
});

describe("refusalErrors", () => {
  it("puts barcode-taken on the row holding the barcode, not a prefix match", () => {
    const prefixRow = row("896400012346");
    const target = row("8964000123466");
    const { errors, focus } = refusalErrors(
      refusal("barcode-taken", productMessages.barcodeTaken("8964000123466", "Tapal")),
      filled({ barcodes: [prefixRow, target] }),
    );
    expect(errors.rows[target.key]?.barcode).toContain("8964000123466");
    expect(errors.rows[prefixRow.key]).toBeUndefined();
    expect(focus).toEqual({ kind: "row", key: target.key, column: "barcode" });
  });

  it("falls back to the form error for an unmatched barcode", () => {
    const message = productMessages.barcodeTaken("999", "Tapal");
    const { errors, focus } = refusalErrors(
      refusal("barcode-taken", message),
      filled({ barcodes: [row("111")] }),
    );
    expect(errors.form).toBe(message);
    expect(focus).toBeNull();
  });

  it("maps internal code and category refusals to their fields", () => {
    const code = refusalErrors(refusal("internal-code-taken", "taken"), filled());
    expect(code.errors.fields.internalCode).toBe("taken");
    const category = refusalErrors(refusal("category-not-found", "gone"), filled());
    expect(category.errors.fields.categoryId).toBe("gone");
    expect(category.focus).toEqual({ kind: "field", field: "categoryId" });
  });
});

describe("saveProduct", () => {
  const payloadResult = buildProductPayload(filled());
  if (!payloadResult.ok) throw new Error("fixture must be valid");
  const { payload } = payloadResult;

  it("creates once on Add", async () => {
    const api = fakeApi();
    const result = await saveProduct(api, null, payload, true);
    expect(result).toEqual({ ok: true, product: product(), statusError: null });
    expect(api.create).toHaveBeenCalledExactlyOnceWith(payload);
    expect(api.update).not.toHaveBeenCalled();
  });

  it("updates once on Edit with the id", async () => {
    const api = fakeApi();
    await saveProduct(api, productId, payload, true);
    expect(api.update).toHaveBeenCalledExactlyOnceWith({ ...payload, id: productId });
    expect(api.create).not.toHaveBeenCalled();
    expect(api.archive).not.toHaveBeenCalled();
    expect(api.restore).not.toHaveBeenCalled();
  });

  it("archives after update when Active is turned off", async () => {
    const api = fakeApi();
    const result = await saveProduct(api, productId, payload, false);
    expect(api.archive).toHaveBeenCalledExactlyOnceWith(productId);
    expect(result).toMatchObject({ ok: true, statusError: null, product: { isActive: false } });
  });

  it("restores when Active is turned on", async () => {
    const api = fakeApi(product({ isActive: false }));
    await saveProduct(api, productId, payload, true);
    expect(api.restore).toHaveBeenCalledExactlyOnceWith(productId);
  });

  it("reports an archive refusal as statusError", async () => {
    const api = fakeApi();
    api.archive.mockResolvedValue({
      ok: false,
      reason: "not-found",
      message: "gone",
    } as never);
    const result = await saveProduct(api, productId, payload, false);
    expect(result).toMatchObject({ ok: true, statusError: "gone", product: { isActive: true } });
  });

  it("returns a create refusal untouched", async () => {
    const api = fakeApi();
    const denied: ProductRefusal = { ok: false, reason: "internal-code-taken", message: "x" };
    api.create.mockResolvedValue(denied as never);
    expect(await saveProduct(api, null, payload, false)).toEqual(refusal);
    expect(api.archive).not.toHaveBeenCalled();
    expect(api.restore).not.toHaveBeenCalled();
  });
});

describe("packPriceHint", () => {
  it("multiplies unit price by pack quantity", () => {
    expect(packPriceHint("125", "12", "piece")).toBe("Rs 1,500");
  });

  it("rounds half up in integer paisa", () => {
    expect(packPriceHint("160.50", "0.333", "kg")).toBe("Rs 53.45");
  });

  it("falls back when the price or quantity does not parse", () => {
    expect(packPriceHint("abc", "12", "piece")).toBe("Unit price × qty");
    expect(packPriceHint("125", "0", "piece")).toBe("Unit price × qty");
  });
});

describe("isFormDirty", () => {
  it("is clean for identical values and dirty after edits", () => {
    const initial = filled();
    expect(isFormDirty(initial, { ...initial })).toBe(false);
    expect(isFormDirty(initial, { ...initial, nameEn: "Other" })).toBe(true);
    expect(isFormDirty(initial, { ...initial, barcodes: [newBarcodeRow()] })).toBe(true);
  });

  it("is clean for values loaded from a product", () => {
    const initial = formFromProduct(product());
    expect(isFormDirty(initial, structuredClone(initial))).toBe(false);
  });
});

describe("formFromProduct", () => {
  it("round-trips to the matching update fields", () => {
    const source = product({ mrpPaisa: 17000, nameUr: "چینی", brand: "Local" });
    const result = buildProductPayload(formFromProduct(source));
    expect(result).toEqual({
      ok: true,
      payload: {
        nameEn: source.nameEn,
        nameUr: source.nameUr,
        categoryId,
        taxCategoryId,
        brand: source.brand,
        unit: source.unit,
        internalCode: source.internalCode,
        costPaisa: source.costPaisa,
        salePricePaisa: source.salePricePaisa,
        mrpPaisa: source.mrpPaisa,
        pctCode: null,
        lowStockThresholdMilli: source.lowStockThresholdMilli,
        barcodes: source.barcodes,
      },
    });
  });
});
