import type { Discount } from "../../shared/checkout";
import {
  assertInteger,
  divRoundHalfUp,
  tenderRoundingPaisa,
  type RoundingSettings,
  type TenderInput,
} from "../../shared/rounding";

export type TotalsLine = {
  id: string;
  position: number;
  isReturn: boolean;
  qtyMilli: number;
  unitPricePaisa: number;
  fixedGrossPaisa: number | null;
  discount: Discount | null;
  taxRateBps: number;
};

export type LineAmounts = {
  id: string;
  grossPaisa: number;
  lineDiscountPaisa: number;
  billDiscountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
};

export type BillTotals = {
  subtotalPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  roundingPaisa: number;
  totalPaisa: number;
};

export function spreadPaisa(
  totalPaisa: number,
  weights: readonly { position: number; weight: number }[],
): number[] {
  assertInteger(totalPaisa, "total");
  const sum = weights.reduce((acc, w) => acc + BigInt(w.weight), 0n);
  if (sum <= 0n || totalPaisa === 0) return weights.map(() => 0);
  const total = BigInt(totalPaisa);
  const shares = weights.map((w) => (total * BigInt(w.weight)) / sum);
  const order = weights
    .map((w, index) => ({
      index,
      position: w.position,
      remainder: (total * BigInt(w.weight)) % sum,
    }))
    .toSorted((a, b) =>
      a.remainder === b.remainder ? a.position - b.position : a.remainder > b.remainder ? -1 : 1,
    );
  let leftover = Number(total - shares.reduce((acc, s) => acc + s, 0n));
  const result = shares.map(Number);
  for (const entry of order) {
    if (leftover <= 0) break;
    result[entry.index] = (result[entry.index] ?? 0) + 1;
    leftover -= 1;
  }
  return result;
}

function discountPaisaFor(discount: Discount | null, basePaisa: number): number {
  if (!discount || basePaisa <= 0) return 0;
  if (discount.kind === "percent") {
    return divRoundHalfUp(BigInt(basePaisa) * BigInt(discount.bps), 10000n);
  }
  return Math.min(discount.amountPaisa, basePaisa);
}

function grossFor(line: TotalsLine): number {
  const sign = line.isReturn ? -1 : 1;
  if (line.fixedGrossPaisa !== null) return sign * line.fixedGrossPaisa;
  const magnitude = divRoundHalfUp(
    BigInt(Math.abs(line.qtyMilli)) * BigInt(line.unitPricePaisa),
    1000n,
  );
  return sign * magnitude;
}

export function computeBill(input: {
  lines: readonly TotalsLine[];
  billDiscount: Discount | null;
  pricesIncludeTax: boolean;
  rounding: RoundingSettings;
  tenders?: readonly TenderInput[];
}): { lines: LineAmounts[]; totals: BillTotals } {
  for (const line of input.lines) {
    assertInteger(line.qtyMilli, "qtyMilli");
    assertInteger(line.unitPricePaisa, "unitPricePaisa");
    assertInteger(line.taxRateBps, "taxRateBps");
    if (line.fixedGrossPaisa !== null) assertInteger(line.fixedGrossPaisa, "fixedGrossPaisa");
  }

  const stage = input.lines.map((line) => {
    const grossPaisa = grossFor(line);
    const lineDiscountPaisa = line.isReturn ? 0 : discountPaisaFor(line.discount, grossPaisa);
    return { line, grossPaisa, lineDiscountPaisa, netPaisa: grossPaisa - lineDiscountPaisa };
  });

  const saleStage = stage.filter((s) => !s.line.isReturn);
  const saleNet = saleStage.reduce((acc, s) => acc + s.netPaisa, 0);
  const billDiscount = discountPaisaFor(input.billDiscount, saleNet);
  const shares = spreadPaisa(
    billDiscount,
    saleStage.map((s) => ({ position: s.line.position, weight: s.netPaisa })),
  );
  const shareById = new Map(saleStage.map((s, index) => [s.line.id, shares[index] ?? 0]));

  const lines = stage.map<LineAmounts>((s) => {
    const billDiscountPaisa = shareById.get(s.line.id) ?? 0;
    const net = s.netPaisa - billDiscountPaisa;
    const rate = BigInt(s.line.taxRateBps);
    const taxPaisa = input.pricesIncludeTax
      ? divRoundHalfUp(BigInt(net) * rate, 10000n + rate)
      : divRoundHalfUp(BigInt(net) * rate, 10000n);
    return {
      id: s.line.id,
      grossPaisa: s.grossPaisa,
      lineDiscountPaisa: s.lineDiscountPaisa,
      billDiscountPaisa,
      taxPaisa,
      totalPaisa: input.pricesIncludeTax ? net : net + taxPaisa,
    };
  });

  const sum = (pick: (line: LineAmounts) => number): number =>
    lines.reduce((acc, line) => acc + pick(line), 0);
  const preTotal = sum((l) => l.totalPaisa);
  const roundingPaisa = tenderRoundingPaisa(preTotal, input.rounding, input.tenders);

  return {
    lines,
    totals: {
      subtotalPaisa: sum((l) => l.grossPaisa),
      discountPaisa: sum((l) => l.lineDiscountPaisa + l.billDiscountPaisa),
      taxPaisa: sum((l) => l.taxPaisa),
      roundingPaisa,
      totalPaisa: preTotal + roundingPaisa,
    },
  };
}
