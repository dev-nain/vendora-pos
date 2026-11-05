import {
  closeShiftInputSchema,
  denominationTotalPaisa,
  floatSchema,
  type CloseShiftInput,
  type Denomination,
} from "@shared/shifts";
import { parseRupees } from "@renderer/lib/money";

export const COUNT_MAX = 100_000;

export type CountMode = "denominations" | "total";

export interface CountFormValues {
  mode: CountMode;
  counts: Record<string, string>;
  totalText: string;
  note: string;
}

export interface CountFormErrors {
  counts: Record<string, string>;
  total?: string;
  note?: string;
}

const countPattern = /^\d{1,6}$/;
const countError = "Whole number, 0 to 100,000";

function parseCount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!countPattern.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= COUNT_MAX ? value : null;
}

export function liveCountedPaisa(
  denominations: readonly Denomination[],
  values: Pick<CountFormValues, "mode" | "counts" | "totalText">,
): number | null {
  if (values.mode === "total") {
    const amount = parseRupees(values.totalText.trim() === "" ? "0" : values.totalText);
    const parsed = amount.ok ? floatSchema.safeParse(amount.paisa) : null;
    return parsed?.success ? parsed.data : null;
  }
  const lines: { valuePaisa: number; count: number }[] = [];
  for (const denomination of denominations) {
    const count = parseCount(values.counts[denomination.id] ?? "");
    if (count === null) return null;
    lines.push({ valuePaisa: denomination.valuePaisa, count });
  }
  return denominationTotalPaisa(lines);
}

export function parseCountForm(
  shiftId: string,
  denominations: readonly Denomination[],
  values: CountFormValues,
): { ok: true; input: CloseShiftInput } | { ok: false; errors: CountFormErrors } {
  const errors: CountFormErrors = { counts: {} };
  const note = values.note.trim();
  const noteField = note === "" ? {} : { note };

  if (values.mode === "total") {
    const counted = liveCountedPaisa(denominations, values);
    if (counted === null) {
      errors.total = "Enter an amount like 5000 or 5000.50";
      return { ok: false, errors };
    }
    return {
      ok: true,
      input: closeShiftInputSchema.parse({
        shiftId,
        count: { method: "total", countedCashPaisa: counted },
        ...noteField,
      }),
    };
  }

  const lines: { denominationId: string; count: number }[] = [];
  for (const denomination of denominations) {
    const count = parseCount(values.counts[denomination.id] ?? "");
    if (count === null) errors.counts[denomination.id] = countError;
    else if (count > 0) lines.push({ denominationId: denomination.id, count });
  }
  if (Object.keys(errors.counts).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: closeShiftInputSchema.parse({
      shiftId,
      count: { method: "denominations", lines },
      ...noteField,
    }),
  };
}
