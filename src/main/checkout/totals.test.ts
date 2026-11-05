import { describe, expect, it } from "vitest";
import type { Discount } from "../../shared/checkout";
import {
  computeBill,
  divRoundHalfUp,
  roundToUnit,
  spreadPaisa,
  type RoundingSettings,
  type TenderInput,
  type TotalsLine,
} from "./totals";

const off: RoundingSettings = { mode: "off", unitPaisa: 100 };

const unitLine = (price: number) => [
  {
    id: "a",
    position: 1,
    isReturn: false,
    qtyMilli: 1000,
    unitPricePaisa: price,
    fixedGrossPaisa: null,
    discount: null,
    taxRateBps: 0,
  } satisfies TotalsLine,
];

function line(overrides: Partial<TotalsLine> & { id: string }): TotalsLine {
  return {
    position: 1,
    isReturn: false,
    qtyMilli: 1000,
    unitPricePaisa: 10000,
    fixedGrossPaisa: null,
    discount: null,
    taxRateBps: 0,
    ...overrides,
  };
}

function bill(
  lines: TotalsLine[],
  options: {
    billDiscount?: Discount | null;
    pricesIncludeTax?: boolean;
    rounding?: RoundingSettings;
    tenders?: TenderInput[];
  } = {},
) {
  return computeBill({
    lines,
    billDiscount: options.billDiscount ?? null,
    pricesIncludeTax: options.pricesIncludeTax ?? true,
    rounding: options.rounding ?? off,
    ...(options.tenders ? { tenders: options.tenders } : {}),
  });
}

describe("divRoundHalfUp", () => {
  it("rounds half away from zero", () => {
    expect(divRoundHalfUp(5n, 10n)).toBe(1);
    expect(divRoundHalfUp(-5n, 10n)).toBe(-1);
    expect(divRoundHalfUp(4n, 10n)).toBe(0);
    expect(divRoundHalfUp(-4n, 10n)).toBe(0);
  });

  it("throws past the safe integer range", () => {
    expect(() => divRoundHalfUp(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1n)).toThrow();
  });
});

describe("roundToUnit", () => {
  it("rounds to the nearest multiple, away from zero on a half", () => {
    expect(roundToUnit(1050, 100)).toBe(1100);
    expect(roundToUnit(1049, 100)).toBe(1000);
    expect(roundToUnit(-1050, 100)).toBe(-1100);
  });
});

describe("spreadPaisa", () => {
  it("gives the leftover to the largest remainders, ties to the lower position", () => {
    const shares = spreadPaisa(100, [
      { position: 3, weight: 1 },
      { position: 1, weight: 1 },
      { position: 2, weight: 1 },
    ]);
    expect(shares).toEqual([33, 34, 33]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("computeBill tax", () => {
  it("extracts tax from a tax-inclusive price", () => {
    const result = bill([line({ id: "a", unitPricePaisa: 11800, taxRateBps: 1800 })]);
    expect(result.totals).toMatchObject({ taxPaisa: 1800, totalPaisa: 11800 });
  });

  it("adds tax on a tax-exclusive price", () => {
    const result = bill([line({ id: "a", unitPricePaisa: 10000, taxRateBps: 1800 })], {
      pricesIncludeTax: false,
    });
    expect(result.totals).toMatchObject({ taxPaisa: 1800, totalPaisa: 11800 });
  });

  it("charges no tax on an exempt line", () => {
    const result = bill([line({ id: "a", taxRateBps: 0 })]);
    expect(result.totals.taxPaisa).toBe(0);
  });
});

describe("computeBill gross and discounts", () => {
  it("prices a weighed line and keeps a fixed gross", () => {
    const weighed = bill([line({ id: "a", qtyMilli: 412, unitPricePaisa: 85000 })]);
    expect(weighed.lines[0]?.grossPaisa).toBe(35020);
    const fixed = bill([
      line({ id: "a", qtyMilli: 412, unitPricePaisa: 85000, fixedGrossPaisa: 35000 }),
    ]);
    expect(fixed.lines[0]?.grossPaisa).toBe(35000);
  });

  it("applies percent and amount line discounts, capped at gross", () => {
    const percent = bill([line({ id: "a", discount: { kind: "percent", bps: 1000 } })]);
    expect(percent.lines[0]?.lineDiscountPaisa).toBe(1000);
    const amount = bill([line({ id: "a", discount: { kind: "amount", amountPaisa: 2500 } })]);
    expect(amount.lines[0]?.lineDiscountPaisa).toBe(2500);
    const capped = bill([line({ id: "a", discount: { kind: "amount", amountPaisa: 99999 } })]);
    expect(capped.lines[0]).toMatchObject({ lineDiscountPaisa: 10000, totalPaisa: 0 });
  });

  it("spreads a bill discount over mixed rates and recomputes tax on each net", () => {
    const lines = [
      line({ id: "a", position: 1, unitPricePaisa: 3333, taxRateBps: 1800 }),
      line({ id: "b", position: 2, unitPricePaisa: 3333, taxRateBps: 500 }),
      line({ id: "c", position: 3, unitPricePaisa: 3333, taxRateBps: 0 }),
    ];
    const percent = bill(lines, { billDiscount: { kind: "percent", bps: 1000 } });
    expect(percent.totals.discountPaisa).toBe(1000);
    expect(percent.lines.map((l) => l.billDiscountPaisa)).toEqual([334, 333, 333]);
    const amount = bill(lines, { billDiscount: { kind: "amount", amountPaisa: 100 } });
    expect(amount.lines.map((l) => l.billDiscountPaisa)).toEqual([34, 33, 33]);
    expect(amount.lines[0]?.taxPaisa).toBe(divRoundHalfUp((3333n - 34n) * 1800n, 11800n));
  });

  it("keeps the totals consistent over random bills", () => {
    let seed = 7;
    const next = (max: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    const rates = [0, 500, 1800];
    for (let run = 0; run < 200; run += 1) {
      const lines = Array.from({ length: 1 + next(6) }, (_, i) =>
        line({
          id: `l${i}`,
          position: i + 1,
          qtyMilli: 1 + next(5000),
          unitPricePaisa: next(50000),
          taxRateBps: rates[next(3)] ?? 0,
          discount: next(2) ? { kind: "percent", bps: next(10001) } : null,
        }),
      );
      const billDiscount: Discount =
        next(2) === 0
          ? { kind: "percent", bps: next(10001) }
          : { kind: "amount", amountPaisa: next(200000) };
      const includeTax = next(2) === 0;
      const result = bill(lines, {
        billDiscount,
        pricesIncludeTax: includeTax,
        rounding: { mode: "every-bill", unitPaisa: 100 },
      });
      const shares = result.lines.reduce((a, l) => a + l.billDiscountPaisa, 0);
      const lineDiscounts = result.lines.reduce((a, l) => a + l.lineDiscountPaisa, 0);
      expect(result.totals.discountPaisa).toBe(shares + lineDiscounts);
      expect(result.totals.taxPaisa).toBe(result.lines.reduce((a, l) => a + l.taxPaisa, 0));
      const expected =
        result.totals.subtotalPaisa -
        result.totals.discountPaisa +
        (includeTax ? 0 : result.totals.taxPaisa) +
        result.totals.roundingPaisa;
      expect(result.totals.totalPaisa).toBe(expected);
      expect(result.totals.totalPaisa % 100).toBe(0);
    }
  });

  it("mirrors a sale line exactly on a return line", () => {
    const sale = bill([line({ id: "a", qtyMilli: 1333, unitPricePaisa: 7777, taxRateBps: 1800 })]);
    const back = bill([
      line({ id: "a", isReturn: true, qtyMilli: -1333, unitPricePaisa: 7777, taxRateBps: 1800 }),
    ]);
    const s = sale.lines[0];
    const r = back.lines[0];
    expect(r?.grossPaisa).toBe(-(s?.grossPaisa ?? 0));
    expect(r?.taxPaisa).toBe(-(s?.taxPaisa ?? 0));
    expect(r?.totalPaisa).toBe(-(s?.totalPaisa ?? 0));
  });
});

describe("computeBill cash rounding", () => {
  it("does nothing when off", () => {
    expect(bill(unitLine(1049)).totals.roundingPaisa).toBe(0);
  });

  it("rounds the pre-total in every-bill mode", () => {
    const result = bill(unitLine(1049), { rounding: { mode: "every-bill", unitPaisa: 100 } });
    expect(result.totals).toMatchObject({ roundingPaisa: -49, totalPaisa: 1000 });
  });

  it("rounds a cash-only tender in cash-only mode", () => {
    const result = bill(unitLine(1049), {
      rounding: { mode: "cash-only", unitPaisa: 100 },
      tenders: [{ method: "cash", amountPaisa: 1000 }],
    });
    expect(result.totals.roundingPaisa).toBe(-49);
  });

  it("rounds only the cash share of a split payment", () => {
    const result = bill(unitLine(1049), {
      rounding: { mode: "cash-only", unitPaisa: 100 },
      tenders: [
        { method: "card", amountPaisa: 333 },
        { method: "cash", amountPaisa: 700 },
      ],
    });
    expect(result.totals).toMatchObject({ roundingPaisa: -16, totalPaisa: 1033 });
  });

  it("does not round a bill with no cash line", () => {
    const result = bill(unitLine(1049), {
      rounding: { mode: "cash-only", unitPaisa: 100 },
      tenders: [{ method: "card", amountPaisa: 1049 }],
    });
    expect(result.totals.roundingPaisa).toBe(0);
  });

  it("is zero in cash-only mode without tenders", () => {
    const result = bill(unitLine(1049), { rounding: { mode: "cash-only", unitPaisa: 100 } });
    expect(result.totals.roundingPaisa).toBe(0);
  });

  it("rounds a cash refund away from zero", () => {
    const result = bill(
      [line({ id: "a", isReturn: true, qtyMilli: -1000, unitPricePaisa: 1050 })],
      {
        rounding: { mode: "cash-only", unitPaisa: 100 },
        tenders: [{ method: "cash", amountPaisa: 1100 }],
      },
    );
    expect(result.totals).toMatchObject({ roundingPaisa: -50, totalPaisa: -1100 });
  });
});

describe("computeBill input checks", () => {
  it("throws on a non-integer input", () => {
    expect(() => bill([line({ id: "a", unitPricePaisa: 10.5 })])).toThrow();
  });
});
