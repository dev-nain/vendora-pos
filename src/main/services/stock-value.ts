import { assertInteger, divRoundHalfUp } from "../../shared/rounding";

export function stockValuePaisa(onHandMilli: number, costPaisa: number): number {
  assertInteger(onHandMilli, "onHandMilli");
  assertInteger(costPaisa, "costPaisa");
  const value = divRoundHalfUp(BigInt(onHandMilli) * BigInt(costPaisa), 1000n);
  return value === 0 ? 0 : value;
}
