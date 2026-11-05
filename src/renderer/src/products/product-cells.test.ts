import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProductSearchItem } from "@shared/products";
import { BarcodeCell, ProductNameCell, StatusBadge } from "./product-cells";

const item: ProductSearchItem = {
  id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b",
  nameEn: "Tapal Danedar 950g",
  nameUr: "ٹپال دانے دار",
  internalCode: "TD-950",
  categoryId: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c",
  unit: "piece",
  salePricePaisa: 125000,
  isActive: true,
  primaryBarcode: "8964000123459",
  extraBarcodeCount: 2,
  onHandMilli: 0,
};

describe("BarcodeCell", () => {
  it("shows the primary barcode with a +N count", () => {
    const html = renderToStaticMarkup(createElement(BarcodeCell, { item }));
    expect(html).toContain("8964000123459");
    expect(html).toContain("+2");
  });

  it("shows no count for a single barcode", () => {
    const html = renderToStaticMarkup(
      createElement(BarcodeCell, { item: { ...item, extraBarcodeCount: 0 } }),
    );
    expect(html).toContain("8964000123459");
    expect(html).not.toContain("+");
  });

  it("shows a dash for a product without a barcode", () => {
    const html = renderToStaticMarkup(
      createElement(BarcodeCell, { item: { ...item, primaryBarcode: null, extraBarcodeCount: 0 } }),
    );
    expect(html).toContain("—");
    expect(html).toContain("No barcode");
  });
});

describe("ProductNameCell", () => {
  it("renders the Urdu name right-to-left", () => {
    const html = renderToStaticMarkup(createElement(ProductNameCell, { item }));
    expect(html).toContain("Tapal Danedar 950g");
    expect(html).toContain('lang="ur"');
    expect(html).toContain('dir="rtl"');
  });

  it("omits the Urdu line when there is no Urdu name", () => {
    const html = renderToStaticMarkup(
      createElement(ProductNameCell, { item: { ...item, nameUr: null } }),
    );
    expect(html).not.toContain('lang="ur"');
  });
});

describe("StatusBadge", () => {
  it("spells the status out", () => {
    expect(renderToStaticMarkup(createElement(StatusBadge, { isActive: true }))).toContain(
      "Active",
    );
    expect(renderToStaticMarkup(createElement(StatusBadge, { isActive: false }))).toContain(
      "Archived",
    );
  });
});
