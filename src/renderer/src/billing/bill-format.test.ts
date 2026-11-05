import type { BillLine } from "@shared/checkout";
import { describe, expect, it } from "vitest";
import {
  billDiscountLabel,
  discountText,
  itemCountText,
  lineDetail,
  lineQuantityText,
  negativeRupees,
} from "./bill-format";

const line = (over: Partial<BillLine>): BillLine => ({
  id: "l1",
  position: 0,
  productId: "p1",
  name: "Item",
  nameUr: null,
  unit: "piece",
  qtyMilli: 1000,
  packQtyMilli: 1000,
  unitPricePaisa: 15000,
  priceType: "original",
  discount: null,
  isReturn: false,
  isDamaged: false,
  refundedLineId: null,
  scaleSource: null,
  isMisc: false,
  grossPaisa: 0,
  lineDiscountPaisa: 0,
  billDiscountPaisa: 0,
  taxRateBps: 0,
  taxPaisa: 0,
  totalPaisa: 0,
  ...over,
});

describe("lineDetail", () => {
  it("reads pieces as count × price", () => {
    expect(lineDetail(line({ qtyMilli: 3000 }))).toBe("3 × Rs 150");
  });

  it("reads weights with three decimals", () => {
    expect(lineDetail(line({ unit: "kg", qtyMilli: 412, unitPricePaisa: 85000 }))).toBe(
      "0.412 kg × Rs 850",
    );
    expect(lineDetail(line({ unit: "litre", qtyMilli: 2000, unitPricePaisa: 20000 }))).toBe(
      "2.000 L × Rs 200",
    );
  });

  it("reads packs as counted packs at the pack price", () => {
    expect(lineDetail(line({ qtyMilli: 2000, packQtyMilli: 24000, unitPricePaisa: 340000 }))).toBe(
      "2 × Pack (24 pcs) at Rs 3,400",
    );
  });

  it("counts a kg pack in packs", () => {
    expect(
      lineDetail(line({ unit: "kg", qtyMilli: 1000, packQtyMilli: 5000, unitPricePaisa: 400000 })),
    ).toBe("1 × Pack (5.000 kg) at Rs 4,000");
  });

  it("flags a changed price but not on a misc line", () => {
    expect(lineDetail(line({ priceType: "manual", unitPricePaisa: 14000 }))).toBe(
      "1 × Rs 140 · Price changed",
    );
    expect(lineDetail(line({ priceType: "manual", isMisc: true, unitPricePaisa: 9000 }))).toBe(
      "1 × Rs 90",
    );
  });
});

describe("lineQuantityText", () => {
  it("is whole for pieces and packs", () => {
    expect(lineQuantityText(line({ qtyMilli: 5000 }))).toBe("5");
    expect(lineQuantityText(line({ unit: "kg", qtyMilli: 3000, packQtyMilli: 5000 }))).toBe("3");
  });
});

describe("discounts", () => {
  it("writes a line discount with a minus sign", () => {
    expect(discountText({ kind: "percent", bps: 1000 })).toBe("−10%");
    expect(discountText({ kind: "percent", bps: 1250 })).toBe("−12.5%");
    expect(discountText({ kind: "amount", amountPaisa: 2000 })).toBe("−Rs 20");
  });

  it("labels the bill discount", () => {
    expect(billDiscountLabel({ kind: "percent", bps: 1000 })).toBe("Bill discount 10%");
    expect(billDiscountLabel({ kind: "amount", amountPaisa: 5000 })).toBe("Bill discount Rs 50");
  });

  it("writes a negative amount", () => {
    expect(negativeRupees(12550)).toBe("−Rs 125.50");
  });
});

describe("itemCountText", () => {
  it("pluralises", () => {
    expect(itemCountText(1)).toBe("1 item");
    expect(itemCountText(0)).toBe("0 items");
    expect(itemCountText(3)).toBe("3 items");
  });
});
