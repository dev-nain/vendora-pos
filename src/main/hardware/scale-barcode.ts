import type { ScaleBarcode } from "../../shared/products";

export interface ScaleBarcodeConfig {
  weightPrefix: string;
  pricePrefix: string;
}

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function parseScaleBarcode(code: string, config: ScaleBarcodeConfig): ScaleBarcode | null {
  if (!/^\d{13}$/.test(code)) return null;
  if (config.weightPrefix === config.pricePrefix) return null;
  if (ean13CheckDigit(code.slice(0, 12)) !== Number(code[12])) return null;

  const prefix = code.slice(0, 2);
  const value = Number(code.slice(7, 12));
  if (value === 0) return null;

  const itemCode = code.slice(2, 7);
  if (prefix === config.weightPrefix) return { itemCode, kind: "weight", qtyMilli: value };
  if (prefix === config.pricePrefix) return { itemCode, kind: "price", pricePaisa: value * 100 };
  return null;
}
