const ratePattern = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

export function parseTaxRatePercent(text: string): { ok: true; rateBps: number } | { ok: false } {
  const match = ratePattern.exec(text.trim());
  if (!match) return { ok: false };
  const rateBps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return rateBps > 10000 ? { ok: false } : { ok: true, rateBps };
}

export function rateInputText(rateBps: number): string {
  const whole = Math.floor(rateBps / 100);
  const fraction = String(rateBps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function formatTaxRate(rateBps: number | null): string {
  return rateBps === null ? "Store rate" : `${rateInputText(rateBps)}%`;
}
