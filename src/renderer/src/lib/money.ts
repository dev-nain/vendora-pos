const rupeePattern = /^(\d{1,13})(?:\.(\d{1,2}))?$/;

export function parseRupees(text: string): { ok: true; paisa: number } | { ok: false } {
  const match = rupeePattern.exec(text.trim());
  if (!match) return { ok: false };
  return { ok: true, paisa: Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) };
}

export function rupeeInputText(paisa: number): string {
  if (!Number.isInteger(paisa) || paisa < 0) throw new Error("Amount must be whole paisa");
  const whole = Math.floor(paisa / 100);
  const fraction = String(paisa % 100).padStart(2, "0");
  return fraction === "00" ? String(whole) : `${whole}.${fraction}`;
}

export { formatRupees } from "@shared/money";
