import { describe, expect, it } from "vitest";
import {
  adjustPricePaisa,
  barcodeLookupInputSchema,
  bulkUpdateProductsInputSchema,
  barcodeLookupSchema,
  createProductInputSchema,
  priceUpdateInput,
  type Product,
  productSearchInputSchema,
  productIdInputSchema,
  updateProductInputSchema,
} from "./products";

const categoryId = "0192f3a0-0000-7000-8000-000000000001";
const taxCategoryId = "0192f3a0-0000-7000-8000-000000000002";

const valid = {
  nameEn: "  Tapal Danedar 950g ",
  nameUr: "",
  categoryId,
  taxCategoryId,
  brand: " Tapal ",
  unit: "piece",
  internalCode: "",
  costPaisa: 90000,
  salePricePaisa: 105000,
  mrpPaisa: 110000,
  pctCode: null,
  lowStockThresholdMilli: 5000,
  barcodes: [{ barcode: " 8961234567890 " }],
};

const issuePaths = (input: unknown) => {
  const result = createProductInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("createProductInputSchema", () => {
  it("trims, nulls blank optionals and defaults the barcode pack", () => {
    const parsed = createProductInputSchema.parse(valid);
    expect(parsed.nameEn).toBe("Tapal Danedar 950g");
    expect(parsed.nameUr).toBeNull();
    expect(parsed.internalCode).toBeNull();
    expect(parsed.brand).toBe("Tapal");
    expect(parsed.barcodes).toEqual([
      { barcode: "8961234567890", packQtyMilli: 1000, salePricePaisa: null },
    ]);
  });

  it.each([
    ["empty name", { nameEn: "" }],
    ["blank name", { nameEn: "   " }],
    ["unknown unit", { unit: "g" }],
    ["fractional cost", { costPaisa: 1.5 }],
    ["negative price", { salePricePaisa: -1 }],
    ["non-uuid category", { categoryId: "nope" }],
    ["isActive key", { isActive: true }],
    ["storeId key", { storeId: categoryId }],
    ["pack qty zero", { barcodes: [{ barcode: "1", packQtyMilli: 0 }] }],
    ["negative pack price", { barcodes: [{ barcode: "1", salePricePaisa: -5 }] }],
    ["barcode with space", { barcodes: [{ barcode: "12 34" }] }],
  ])("rejects %s", (_label, patch) => {
    expect(createProductInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("reports MRP below the sale price on mrpPaisa", () => {
    expect(issuePaths({ ...valid, mrpPaisa: 100 })).toEqual(["mrpPaisa"]);
  });

  it("reports a duplicate barcode on the second occurrence", () => {
    expect(issuePaths({ ...valid, barcodes: [{ barcode: "1" }, { barcode: "1" }] })).toEqual([
      "barcodes.1.barcode",
    ]);
  });

  it("accepts MRP equal to the sale price and a null MRP", () => {
    expect(createProductInputSchema.safeParse({ ...valid, mrpPaisa: 105000 }).success).toBe(true);
    expect(createProductInputSchema.safeParse({ ...valid, mrpPaisa: null }).success).toBe(true);
  });
});

describe("updateProductInputSchema", () => {
  it("requires a uuid id and keeps the cross-field rules", () => {
    expect(updateProductInputSchema.safeParse(valid).success).toBe(false);
    expect(updateProductInputSchema.safeParse({ ...valid, id: "x" }).success).toBe(false);
    expect(updateProductInputSchema.safeParse({ ...valid, id: categoryId }).success).toBe(true);
    expect(
      updateProductInputSchema.safeParse({ ...valid, id: categoryId, mrpPaisa: 1 }).success,
    ).toBe(false);
  });
});

describe("productIdInputSchema", () => {
  it("accepts a uuid and rejects a bad id or an extra key", () => {
    expect(productIdInputSchema.safeParse({ id: categoryId }).success).toBe(true);
    expect(productIdInputSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(productIdInputSchema.safeParse({ id: categoryId, extra: 1 }).success).toBe(false);
  });
});

describe("productSearchInputSchema", () => {
  const base = { query: "", limit: 20, offset: 0 };

  it("accepts a minimal input", () => {
    expect(productSearchInputSchema.safeParse(base).success).toBe(true);
  });

  it.each([
    ["limit 0", { limit: 0 }],
    ["limit 101", { limit: 101 }],
    ["fractional limit", { limit: 1.5 }],
    ["negative offset", { offset: -1 }],
    ["oversized query", { query: "a".repeat(201) }],
    ["non-uuid category", { categoryId: "x" }],
    ["unknown key", { storeId: "s" }],
  ])("rejects %s", (_name, extra) => {
    expect(productSearchInputSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });
});

describe("barcodeLookupInputSchema", () => {
  it("trims the barcode", () => {
    expect(barcodeLookupInputSchema.parse({ barcode: " 123 " })).toEqual({ barcode: "123" });
  });

  it("rejects blank and oversized barcodes", () => {
    expect(barcodeLookupInputSchema.safeParse({ barcode: "  " }).success).toBe(false);
    expect(barcodeLookupInputSchema.safeParse({ barcode: "1".repeat(65) }).success).toBe(false);
  });
});

describe("barcodeLookupSchema", () => {
  const product = {
    id: "p1",
    nameEn: "Tea",
    nameUr: null,
    unit: "piece",
    salePricePaisa: 100,
    taxCategoryId: "t1",
    costPaisa: 80,
  };

  it("accepts a barcode result and a scale result", () => {
    expect(
      barcodeLookupSchema.safeParse({
        source: "barcode",
        product,
        packQtyMilli: 1000,
        packPricePaisa: null,
      }).success,
    ).toBe(true);
    expect(
      barcodeLookupSchema.safeParse({
        source: "scale",
        product,
        scale: { itemCode: "00001", kind: "weight", qtyMilli: 500 },
      }).success,
    ).toBe(true);
  });
});

describe("adjustPricePaisa", () => {
  it.each([
    [125000, -1000, 112500],
    [16050, 1000, 17700],
    [100, 5000, 200],
    [40, -5000, 0],
    [99, -100, 100],
    [0, 5000, 0],
  ])("%i paisa at %i bps is %i", (price, bps, expected) => {
    expect(adjustPricePaisa(price, bps)).toBe(expected);
  });

  it("throws when the result is not a safe integer", () => {
    expect(() => adjustPricePaisa(Number.MAX_SAFE_INTEGER, 100000)).toThrow(RangeError);
  });
});

describe("bulkUpdateProductsInputSchema", () => {
  const id = "0192f3a0-0000-7000-8000-000000000001";
  const adjust = (bps: number) => ({
    productIds: [id],
    change: { kind: "adjust-price", bps },
  });

  it.each([-10000, -10001, 0, 100001])("rejects bps %i", (bps) => {
    expect(bulkUpdateProductsInputSchema.safeParse(adjust(bps)).success).toBe(false);
  });

  it("accepts the bps bounds", () => {
    expect(bulkUpdateProductsInputSchema.safeParse(adjust(-9999)).success).toBe(true);
    expect(bulkUpdateProductsInputSchema.safeParse(adjust(100000)).success).toBe(true);
  });

  it("rejects empty, oversized and non-uuid id lists", () => {
    const change = { kind: "set-price", salePricePaisa: 100 };
    expect(bulkUpdateProductsInputSchema.safeParse({ productIds: [], change }).success).toBe(false);
    const many = Array.from(
      { length: 5001 },
      (_, i) => `0192f3a0-0000-7000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(bulkUpdateProductsInputSchema.safeParse({ productIds: many, change }).success).toBe(
      false,
    );
    expect(bulkUpdateProductsInputSchema.safeParse({ productIds: ["nope"], change }).success).toBe(
      false,
    );
  });

  it("collapses duplicate ids", () => {
    const parsed = bulkUpdateProductsInputSchema.parse({
      productIds: [id, id],
      change: { kind: "set-price", salePricePaisa: 100 },
    });
    expect(parsed.productIds).toEqual([id]);
  });
});

describe("priceUpdateInput", () => {
  const product: Product = {
    id: categoryId,
    nameEn: "Tapal",
    nameUr: "Tapal Urdu",
    categoryId,
    taxCategoryId,
    brand: "Tapal",
    unit: "piece",
    internalCode: "T1",
    costPaisa: 105000,
    salePricePaisa: 125000,
    mrpPaisa: 130000,
    pctCode: "0902",
    lowStockThresholdMilli: 5000,
    isActive: true,
    barcodes: [
      { barcode: "8964000000011", packQtyMilli: 1000, salePricePaisa: null },
      { barcode: "8964000000012", packQtyMilli: 12000, salePricePaisa: 1400000 },
    ],
  };

  it("copies every field and replaces only the sale price", () => {
    const { isActive: _isActive, ...rest } = product;
    expect(priceUpdateInput(product, 129000)).toEqual({ ...rest, salePricePaisa: 129000 });
  });

  it("fails the update schema on mrpPaisa when the price is over the MRP", () => {
    const result = updateProductInputSchema.safeParse(priceUpdateInput(product, 140000));
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "mrpPaisa",
    ]);
  });
});
