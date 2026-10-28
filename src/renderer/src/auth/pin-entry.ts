export const PIN_MAX_LENGTH = 6;
export const PIN_MIN_LENGTH = 4;

export const sanitizePin = (value: string): string =>
  value.replaceAll(/\D/g, "").slice(0, PIN_MAX_LENGTH);

export const appendDigit = (value: string, digit: string): string => sanitizePin(value + digit);

export function digitFromKey(key: string, code: string): string | null {
  if (/^[0-9]$/.test(key)) return key;
  const numpad = /^Numpad([0-9])$/.exec(code);
  return numpad?.[1] ?? null;
}
