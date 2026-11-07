import { z } from "zod";
import { refusal } from "./checkout";

export const invoiceMessages = {
  notFound: "That sale no longer exists. Refresh.",
  pdfFailed: "Couldn't save the PDF. If it's open in another program, close it and try again.",
  printFailed: "Couldn't print. Check the printer in Windows and try again.",
} as const;

export const saveInvoicePdfResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), status: z.literal("saved"), path: z.string() }),
  z.strictObject({ ok: z.literal(true), status: z.literal("cancelled") }),
  refusal("not-found"),
  refusal("failed"),
]);

export const printInvoiceResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), status: z.enum(["printed", "cancelled"]) }),
  refusal("not-found"),
  refusal("failed"),
]);

export type SaveInvoicePdfResult = z.infer<typeof saveInvoicePdfResultSchema>;
export type PrintInvoiceResult = z.infer<typeof printInvoiceResultSchema>;
