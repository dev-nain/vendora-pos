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
