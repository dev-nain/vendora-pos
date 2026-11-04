import type { PaymentMethod } from "./checkout";

export type RoundingSettings = {
  mode: "off" | "every-bill" | "cash-only";
  unitPaisa: number;
};

export type TenderInput = { method: PaymentMethod; amountPaisa: number };

export function assertInteger(value: number, name: string): void {
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

export function tenderRoundingPaisa(
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
