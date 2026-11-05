export function weightedAverageCostPaisa(input: {
  onHandMilli: number;
  averageCostPaisa: number;
  incomingQtyMilli: number;
  incomingCostPaisa: number;
}): number {
  const { onHandMilli, averageCostPaisa, incomingQtyMilli, incomingCostPaisa } = input;
  if (incomingQtyMilli <= 0) return averageCostPaisa;
  if (onHandMilli <= 0) return incomingCostPaisa;

  // BigInt: stock x cost products can exceed 2^53.
  const numerator =
    BigInt(onHandMilli) * BigInt(averageCostPaisa) +
    BigInt(incomingQtyMilli) * BigInt(incomingCostPaisa);
  const denominator = BigInt(onHandMilli) + BigInt(incomingQtyMilli);
  const rounded = (2n * numerator + denominator) / (2n * denominator);

  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Average cost is out of range");
  }
  return Number(rounded);
}
