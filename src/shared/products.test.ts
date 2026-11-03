import { describe, expect, it } from "vitest";
import { createProductInputSchema, updateProductInputSchema } from "./products";

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
