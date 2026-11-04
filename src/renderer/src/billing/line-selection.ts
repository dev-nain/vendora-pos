import type { Bill, BillLine } from "@shared/checkout";

const sameDiscount = (a: BillLine["discount"], b: BillLine["discount"]) =>
  JSON.stringify(a) === JSON.stringify(b);

const changed = (before: BillLine, after: BillLine) =>
  before.qtyMilli !== after.qtyMilli ||
  before.unitPricePaisa !== after.unitPricePaisa ||
  !sameDiscount(before.discount, after.discount);

export function selectAfter(prev: Bill | null, next: Bill, current: string | null): string | null {
  const before = new Map((prev?.id === next.id ? prev.lines : []).map((line) => [line.id, line]));
  const added = next.lines.find((line) => !before.has(line.id));
  if (added) return added.id;
  const edited = next.lines.find((line) => {
    const old = before.get(line.id);
    return old !== undefined && changed(old, line);
  });
  if (edited) return edited.id;
  if (current !== null && next.lines.some((line) => line.id === current)) return current;
  return next.lines.at(-1)?.id ?? null;
}

export function selectAfterDelete(lines: BillLine[], deletedId: string): string | null {
  const remaining = lines.filter((line) => line.id !== deletedId);
  const index = lines.findIndex((line) => line.id === deletedId);
  if (index > 0) return lines[index - 1]?.id ?? null;
  return remaining.at(-1)?.id ?? null;
}

export function moveSelection(
  lines: BillLine[],
  current: string | null,
  step: 1 | -1,
): string | null {
  if (lines.length === 0) return null;
  const index = lines.findIndex((line) => line.id === current);
  if (index === -1) return lines.at(step === 1 ? 0 : -1)?.id ?? null;
  const target = Math.min(Math.max(index + step, 0), lines.length - 1);
  return lines[target]?.id ?? null;
}
