export const autoLockInputMessage = "Enter a whole number from 1 to 60.";

export type AutoLockInputResult = { ok: true; minutes: number } | { ok: false };

export function parseAutoLockMinutes(text: string): AutoLockInputResult {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return { ok: false };
  const minutes = Number(trimmed);
  if (minutes < 1 || minutes > 60) return { ok: false };
  return { ok: true, minutes };
}
