import type { PaymentMethod } from "../../shared/checkout";

export type Discount = { kind: "amount"; amountPaisa: number } | { kind: "percent"; bps: number };

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

export type RoundingSettings = {
  mode: "off" | "every-bill" | "cash-only";
  unitPaisa: number;
};

export type TenderInput = { method: PaymentMethod; amountPaisa: number };

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

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
}

export function divRoundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new Error("Denominator must be positive");
  const magnitude = numerator < 0n ? -numerator : numerator;
  const quotient = (2n * magnitude + denominator) / (2n * denominator);
  const result = numerator < 0n ? -quotient : quotient;
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount is too large");
  }
  return Number(result);
}

export function roundToUnit(paisa: number, unitPaisa: number): number {
  assertInteger(paisa, "paisa");
  assertInteger(unitPaisa, "unit");
  if (unitPaisa <= 0) throw new Error("Rounding unit must be positive");
  return divRoundHalfUp(BigInt(paisa), BigInt(unitPaisa)) * unitPaisa;
}

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

function roundingFor(
  preTotal: number,
  rounding: RoundingSettings,
  tenders: readonly TenderInput[] | undefined,
): number {
  if (rounding.mode === "off") return 0;
  if (rounding.mode === "every-bill") {
    return roundToUnit(preTotal, rounding.unitPaisa) - preTotal;
  }
  if (!tenders?.some((t) => t.method === "cash")) return 0;
  const nonCash = tenders
    .filter((t) => t.method !== "cash")
    .reduce((acc, t) => acc + t.amountPaisa, 0);
  const cashShare = preTotal - nonCash;
  if (cashShare === 0) return 0;
  return roundToUnit(cashShare, rounding.unitPaisa) - cashShare;
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
  const roundingPaisa = roundingFor(preTotal, input.rounding, input.tenders);

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
