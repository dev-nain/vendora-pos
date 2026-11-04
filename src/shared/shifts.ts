import { z } from "zod";
import { refusal } from "./checkout";

export const shiftMessages = {
  alreadyOpen: "A shift is already open on this counter.",
  noOpenShift: "Open a shift first.",
  notFound: "That entry no longer exists. Refresh.",
  shiftClosed: "This shift is closed. Cash moves can't change after close.",
  notOpen: "This shift is already closed.",
  heldBills: "Resume or discard the held bills before closing.",
  unknownDenomination: "That note or coin isn't in the list. Refresh and count again.",
} as const;

const maxPaisa = 100_000_000_00;

export const paisaAmountSchema = z.int().min(1).max(maxPaisa);
export const floatSchema = z.int().min(0).max(maxPaisa);
export const countSchema = z.int().min(0).max(100_000);

export const openShiftInputSchema = z.strictObject({ openingFloatPaisa: floatSchema });

export const addCashMoveInputSchema = z.strictObject({
  kind: z.enum(["in", "out"]),
  amountPaisa: paisaAmountSchema,
  reason: z.string().trim().min(1, "Enter a reason").max(120),
});

export const cashMoveIdInputSchema = z.strictObject({ id: z.uuid() });

export const shiftIdInputSchema = z.strictObject({ id: z.uuid() });

const denominationLinesSchema = z
  .array(z.strictObject({ denominationId: z.uuid(), count: countSchema }))
  .max(50)
  .refine((lines) => new Set(lines.map((line) => line.denominationId)).size === lines.length, {
    message: "Each note or coin can be counted once",
  });

export const closeShiftInputSchema = z.strictObject({
  shiftId: z.uuid(),
  count: z.discriminatedUnion("method", [
    z.strictObject({ method: z.literal("denominations"), lines: denominationLinesSchema }),
    z.strictObject({ method: z.literal("total"), countedCashPaisa: floatSchema }),
  ]),
  note: z.string().trim().max(500).optional(),
});

const isoSchema = z.iso.datetime();
const userNameSchema = z.string();

export const denominationSchema = z.strictObject({
  id: z.string(),
  valuePaisa: z.int(),
  kind: z.enum(["note", "coin"]),
});

export const cashMoveSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["in", "out"]),
  amountPaisa: z.int(),
  reason: z.string(),
  createdBy: z.strictObject({ id: z.string(), displayName: userNameSchema }),
  createdAt: isoSchema,
});

export const heldBillSummarySchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  totalPaisa: z.int(),
  heldAt: isoSchema,
});

const cashMovesSectionSchema = z.strictObject({
  moves: z.array(cashMoveSchema),
  totalPaisa: z.int(),
});

export const shiftReportSchema = z.strictObject({
  kind: z.enum(["x", "z"]),
  shiftId: z.string(),
  terminalCode: z.string(),
  openedBy: userNameSchema,
  openedAt: isoSchema,
  closedBy: userNameSchema.nullable(),
  closedAt: isoSchema.nullable(),
  openingFloatPaisa: z.int(),
  cashIn: cashMovesSectionSchema,
  cashOut: cashMovesSectionSchema,
  expectedByMethod: z.array(
    z.strictObject({
      method: z.enum(["cash"]),
      label: z.string(),
      expectedPaisa: z.int(),
    }),
  ),
  expectedCashPaisa: z.int(),
  count: z
    .strictObject({
      method: z.enum(["denominations", "total"]),
      lines: z.array(z.strictObject({ valuePaisa: z.int(), count: z.int(), totalPaisa: z.int() })),
      countedCashPaisa: z.int(),
    })
    .nullable(),
  variancePaisa: z.int().nullable(),
  note: z.string().nullable(),
});

export const shiftStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("closed"), suggestedFloatPaisa: z.int() }),
  z.strictObject({
    status: z.literal("open"),
    shift: z.strictObject({ id: z.string(), openedAt: isoSchema, openedBy: userNameSchema }),
    report: shiftReportSchema,
    heldBills: z.array(heldBillSummarySchema),
    varianceWarnPaisa: z.int(),
  }),
]);

const alreadyOpenSchema = refusal("already-open");
const noOpenShiftSchema = refusal("no-open-shift");
const notFoundSchema = refusal("not-found");
const shiftClosedSchema = refusal("shift-closed");
const notOpenSchema = refusal("not-open");
const unknownDenominationSchema = refusal("unknown-denomination");
const heldBillsRefusalSchema = z.strictObject({
  ok: z.literal(false),
  reason: z.literal("held-bills"),
  message: z.string(),
  bills: z.array(heldBillSummarySchema),
});

export const openShiftResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    shift: z.strictObject({ id: z.string(), openedAt: isoSchema, openedBy: userNameSchema }),
  }),
  alreadyOpenSchema,
]);

export const addCashMoveResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), move: cashMoveSchema }),
  noOpenShiftSchema,
]);

export const deleteCashMoveResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  notFoundSchema,
  shiftClosedSchema,
]);

export const shiftReportResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), report: shiftReportSchema }),
  notFoundSchema,
]);

export const closeShiftResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), report: shiftReportSchema }),
  notOpenSchema,
  heldBillsRefusalSchema,
  unknownDenominationSchema,
]);

export type OpenShiftInput = z.input<typeof openShiftInputSchema>;
export type AddCashMoveInput = z.input<typeof addCashMoveInputSchema>;
export type CloseShiftInput = z.input<typeof closeShiftInputSchema>;
export type Denomination = z.infer<typeof denominationSchema>;
export type CashMove = z.infer<typeof cashMoveSchema>;
export type HeldBillSummary = z.infer<typeof heldBillSummarySchema>;
export type ShiftReport = z.infer<typeof shiftReportSchema>;
export type ShiftState = z.infer<typeof shiftStateSchema>;
export type OpenShiftResult = z.infer<typeof openShiftResultSchema>;
export type AddCashMoveResult = z.infer<typeof addCashMoveResultSchema>;
export type DeleteCashMoveResult = z.infer<typeof deleteCashMoveResultSchema>;
export type ShiftReportResult = z.infer<typeof shiftReportResultSchema>;
export type CloseShiftResult = z.infer<typeof closeShiftResultSchema>;

function assertPaisa(value: number): void {
  if (!Number.isSafeInteger(value)) throw new Error("Amounts must be whole paisa");
}

export function sumPaisa(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertPaisa(amount);
    total += amount;
  }
  assertPaisa(total);
  return total;
}

export function expectedCashPaisa(input: {
  openingFloatPaisa: number;
  cashInPaisa: number;
  cashOutPaisa: number;
}): number {
  return sumPaisa([input.openingFloatPaisa, input.cashInPaisa, -input.cashOutPaisa]);
}

export function denominationTotalPaisa(
  lines: readonly { valuePaisa: number; count: number }[],
): number {
  return sumPaisa(
    lines.map((line) => {
      assertPaisa(line.valuePaisa);
      assertPaisa(line.count);
      return line.valuePaisa * line.count;
    }),
  );
}

export function variancePaisa(countedPaisa: number, expectedPaisa: number): number {
  return sumPaisa([countedPaisa, -expectedPaisa]);
}

export function isVarianceWarning(variance: number, thresholdPaisa: number): boolean {
  assertPaisa(variance);
  assertPaisa(thresholdPaisa);
  return Math.abs(variance) > thresholdPaisa;
}
