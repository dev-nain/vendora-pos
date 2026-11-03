import { describe, expect, it } from "vitest";
import type { ProductSearchItem } from "@shared/products";
import { buildChange, parsePercent, previewRows } from "./bulk-edit";

const item = (n: number, salePricePaisa: number, categoryId = "c1"): ProductSearchItem => ({
  id: `id-${n}`,
  nameEn: `Item ${n}`,
  nameUr: null,
  internalCode: null,
  categoryId,
  unit: "piece",
  salePricePaisa,
  isActive: true,
  primaryBarcode: null,
  extraBarcodeCount: 0,
});

const names = new Map([
  ["c1", "General"],
  ["c2", "Beverages"],
]);

describe("parsePercent", () => {
  it.each([
    ["10", 1000],
    ["-10", -1000],
    ["+12.5", 1250],
    ["7.25", 725],
    [" 0.01 ", 1],
    ["1000", 100000],
    ["-99.99", -9999],
  ])("parses %j as %i bps", (text, bps) => {
    expect(parsePercent(text)).toEqual({ ok: true, bps });
  });

  it.each(["", "0", "-0", "0.00", "-100", "-101", "1000.01", "1001", "1.234", "abc", "1,5", "--5"])(
    "rejects %j",
    (text) => {
      expect(parsePercent(text)).toMatchObject({ ok: false });
    },
  );
});

describe("buildChange", () => {
  const form = { mode: "percent", percent: "", price: "", categoryId: null } as const;

  it("builds each kind of change", () => {
    expect(buildChange({ ...form, percent: "-10" })).toEqual({ kind: "adjust-price", bps: -1000 });
    expect(buildChange({ ...form, mode: "price", price: "160.50" })).toEqual({
      kind: "set-price",
      salePricePaisa: 16050,
    });
    expect(buildChange({ ...form, mode: "category", categoryId: "c2" })).toEqual({
      kind: "category",
      categoryId: "c2",
    });
  });

  it("returns no message for empty input and a message for bad input", () => {
    expect(buildChange(form)).toEqual({ error: null });
    expect(buildChange({ ...form, mode: "price" })).toEqual({ error: null });
    expect(buildChange({ ...form, mode: "category" })).toEqual({ error: null });
    expect(buildChange({ ...form, percent: "-100" })).toMatchObject({ error: expect.any(String) });
    expect(buildChange({ ...form, mode: "price", price: "1.234" })).toMatchObject({
      error: expect.any(String),
    });
  });
});

describe("previewRows", () => {
  const items = [item(1, 16050), item(2, 100), item(3, 33000), item(4, 500), item(5, 500)];

  it("shows before and after for price adjustments and skips unchanged rows", () => {
    const preview = previewRows(items, { kind: "adjust-price", bps: 1000 }, names);
    expect(preview.total).toBe(5);
    expect(preview.changing).toBe(4);
    expect(preview.rows[0]).toEqual({
      id: "id-1",
      nameEn: "Item 1",
      before: "Rs 160.50",
      after: "Rs 177",
    });
  });

  it("excludes products already at the target price", () => {
    const preview = previewRows(items, { kind: "set-price", salePricePaisa: 500 }, names);
    expect(preview.changing).toBe(3);
    expect(preview.rows.map((r) => r.id)).toEqual(["id-1", "id-2", "id-3"]);
  });

  it("limits rows but counts every change", () => {
    const many = Array.from({ length: 8 }, (_, i) => item(i, 1000));
    const preview = previewRows(many, { kind: "set-price", salePricePaisa: 2000 }, names, 5);
    expect(preview.changing).toBe(8);
    expect(preview.rows).toHaveLength(5);
  });

  it("uses category names", () => {
    const preview = previewRows(
      [item(1, 100), item(2, 100, "c2")],
      { kind: "category", categoryId: "c2" },
      names,
    );
    expect(preview.changing).toBe(1);
    expect(preview.rows).toEqual([
      { id: "id-1", nameEn: "Item 1", before: "General", after: "Beverages" },
    ]);
  });
});
