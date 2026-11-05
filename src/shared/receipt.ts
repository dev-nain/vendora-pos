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
