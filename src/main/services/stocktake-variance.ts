import { stockValuePaisa } from "./stock-value";

interface VarianceInput {
  countedMilli: number;
  expectedMilli: number;
  costPaisa: number;
}

export function lineVariance({ countedMilli, expectedMilli, costPaisa }: VarianceInput) {
  const varianceMilli = countedMilli - expectedMilli;
  return { varianceMilli, varianceValuePaisa: stockValuePaisa(varianceMilli, costPaisa) };
}

export function varianceTotals(lines: { varianceMilli: number; varianceValuePaisa: number }[]) {
  let varianceLineCount = 0;
  let shortValuePaisa = 0;
  let surplusValuePaisa = 0;
  for (const line of lines) {
    if (line.varianceMilli !== 0) varianceLineCount += 1;
    if (line.varianceValuePaisa < 0) shortValuePaisa += line.varianceValuePaisa;
    else surplusValuePaisa += line.varianceValuePaisa;
  }
  return {
    varianceLineCount,
    shortValuePaisa,
    surplusValuePaisa,
    netValuePaisa: shortValuePaisa + surplusValuePaisa,
  };
}
