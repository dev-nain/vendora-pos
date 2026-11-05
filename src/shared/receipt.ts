import { z } from "zod";

export const printerMessages = {
  notSetUp: "No printer set up",
  error: "Printer error",
  offline: "Printer offline — check paper or cable.",
  didNotPrint: "Receipt didn't print",
  notFound: "Printer not found. Pick it again in Settings.",
} as const;

export const printResultSchema = z.strictObject({
  successful: z.boolean(),
  canRetry: z.boolean(),
  message: z.string(),
});

export type PrintResult = z.infer<typeof printResultSchema>;

export const saleIdInputSchema = z.strictObject({ saleId: z.uuid() });

export const printShiftReportInputSchema = z.strictObject({ shiftId: z.uuid() });

export const saleJobResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("printed") }),
  z.strictObject({
    state: z.literal("failed"),
    canRetry: z.boolean(),
    message: z.string(),
  }),
  z.strictObject({ state: z.literal("ask") }),
  z.strictObject({ state: z.literal("off") }),
  z.strictObject({ state: z.literal("no-printer"), message: z.string() }),
  z.strictObject({ state: z.literal("none") }),
]);

export const printerStatusSchema = z.strictObject({
  state: z.enum(["ok", "not-set-up", "error"]),
  message: z.string(),
});

export const countPhaseInputSchema = z.strictObject({ phase: z.enum(["opening", "closing"]) });

export const openDrawerForCountResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), reason: z.literal("wrong-phase"), message: z.string() }),
]);

export type SaleJobResult = z.infer<typeof saleJobResultSchema>;
export type PrinterStatus = z.infer<typeof printerStatusSchema>;
export type CountPhase = z.infer<typeof countPhaseInputSchema>["phase"];
export type OpenDrawerForCountResult = z.infer<typeof openDrawerForCountResultSchema>;

export type ReceiptWidthPx = 384 | 576;

export interface ReceiptMetrics {
  bodyPx: number;
  titlePx: number;
  urduLineHeight: number;
  latinLineHeight: number;
}

export type ReceiptBlock =
  | {
      type: "text";
      text: string;
      lang: "en" | "ur";
      align: "left" | "center" | "right";
      size: "body" | "title";
      weight: "normal" | "bold";
    }
  | {
      type: "pair";
      left: string;
      right: string;
      weight: "normal" | "bold";
      size: "body" | "title";
    }
  | { type: "rule" }
  | { type: "gap"; heightPx: number }
  | { type: "table"; header: string[]; rows: string[][] }
  | {
      type: "barcode";
      modules: boolean[];
      moduleWidthPx: 1 | 2;
      heightPx: number;
      caption: string;
    };

export interface ReceiptModel {
  widthPx: ReceiptWidthPx;
  metrics: ReceiptMetrics;
  blocks: ReceiptBlock[];
}
