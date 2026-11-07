import { assertInteger, divRoundHalfUp } from "../../shared/rounding";
import { salesTaxPaisa } from "../checkout/totals";

export function exTaxPricePaisa(
  salePricePaisa: number,
  rateBps: number,
  pricesIncludeTax: boolean,
): number {
  assertInteger(salePricePaisa, "salePricePaisa");
  assertInteger(rateBps, "rateBps");
  return pricesIncludeTax
    ? salePricePaisa - salesTaxPaisa(salePricePaisa, rateBps, true)
    : salePricePaisa;
}

export function marginBps(exTaxPaisa: number, costPaisa: number): number | null {
  assertInteger(exTaxPaisa, "exTaxPaisa");
  assertInteger(costPaisa, "costPaisa");
  if (exTaxPaisa <= 0) return null;
  return divRoundHalfUp(BigInt(exTaxPaisa - costPaisa) * 10000n, BigInt(exTaxPaisa));
}

export function isBelowThreshold(
  exTaxPaisa: number,
  costPaisa: number,
  thresholdBps: number,
): boolean {
  assertInteger(exTaxPaisa, "exTaxPaisa");
  assertInteger(costPaisa, "costPaisa");
  assertInteger(thresholdBps, "thresholdBps");
  if (exTaxPaisa <= 0) return true;
  return BigInt(exTaxPaisa - costPaisa) * 10000n < BigInt(thresholdBps) * BigInt(exTaxPaisa);
}
