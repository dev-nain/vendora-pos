import { z } from "zod";
import { ntnSchema } from "./checkout";

export const printerKinds = ["none", "windows", "network"] as const;
export const printModes = ["print", "ask", "off"] as const;
export type PaperWidthMm = 58 | 80;

export const miscItemInputSchema = z.strictObject({ enabled: z.boolean() });

export const miscItemSettingSchema = z.strictObject({ enabled: z.boolean() });

const warnPaisaSchema = z.int().min(0).max(100_000_000);

export const shiftVarianceInputSchema = z.strictObject({ warnPaisa: warnPaisaSchema });

export const shiftVarianceSettingSchema = z.strictObject({ warnPaisa: warnPaisaSchema });

export const marginThresholdBpsSchema = z.int().min(0).max(10000).nullable();

export const marginThresholdInputSchema = z.strictObject({
  thresholdBps: marginThresholdBpsSchema,
});

export const marginThresholdSettingSchema = z.strictObject({
  thresholdBps: marginThresholdBpsSchema,
});

export const scalePrefixSchema = z.string().regex(/^\d{2}$/);

const scalePrefixesShape = {
  weightPrefix: scalePrefixSchema,
  pricePrefix: scalePrefixSchema,
};

// Not a DB CHECK: a cross-column check makes drizzle-kit rebuild the stores table.
export const scalePrefixesInputSchema = z
  .strictObject(scalePrefixesShape)
  .refine((v) => v.weightPrefix !== v.pricePrefix, {
    message: "Weight and price prefixes must differ",
    path: ["pricePrefix"],
  });

export const scalePrefixesSettingSchema = z.strictObject(scalePrefixesShape);

export type ScalePrefixesInput = z.infer<typeof scalePrefixesInputSchema>;
export type ScalePrefixesSetting = z.infer<typeof scalePrefixesSettingSchema>;
export type MiscItemInput = z.infer<typeof miscItemInputSchema>;
export type MiscItemSetting = z.infer<typeof miscItemSettingSchema>;
export type ShiftVarianceInput = z.infer<typeof shiftVarianceInputSchema>;
export type ShiftVarianceSetting = z.infer<typeof shiftVarianceSettingSchema>;

export type MarginThresholdInput = z.infer<typeof marginThresholdInputSchema>;
export type MarginThresholdSetting = z.infer<typeof marginThresholdSettingSchema>;

export const blankToNull = (value: string | null) =>
  value === null || value.trim() === "" ? null : value.trim();

export const textField = (max: number, message: string) =>
  z.string().nullable().transform(blankToNull).pipe(z.string().max(max, message).nullable());

const maxLines = 4;
const multilineField = (label: string) =>
  z
    .string()
    .nullable()
    .transform(blankToNull)
    .pipe(
      z
        .string()
        .max(300, `${label} is up to 300 characters.`)
        .refine((v) => v.split(/\r?\n/).length <= maxLines, `${label} is up to ${maxLines} lines.`)
        .nullable(),
    );

const strnSchema = z
  .string()
  .transform((value) => value.replaceAll("-", ""))
  .pipe(z.string().regex(/^\d{13}$/, "STRN is 13 digits."));

export const phoneField = z
  .string()
  .nullable()
  .transform(blankToNull)
  .pipe(
    z
      .string()
      .max(30, "Phone is up to 30 characters.")
      .regex(/^[\d\s+-]+$/, "Phone has digits, spaces, + and - only.")
      .nullable(),
  );

export const ntnField = z.string().nullable().transform(blankToNull).pipe(ntnSchema.nullable());

const receiptShape = {
  name: textField(100, "Store name is up to 100 characters."),
  address: textField(200, "Address is up to 200 characters."),
  phone: phoneField,
  ntn: ntnField,
  strn: z.string().nullable().transform(blankToNull).pipe(strnSchema.nullable()),
  headerEn: multilineField("Header"),
  headerUr: multilineField("Header"),
  footerEn: multilineField("Footer"),
  footerUr: multilineField("Footer"),
};

export const receiptSettingsInputSchema = z.strictObject(receiptShape);

const nullableText = z.string().nullable();

export const receiptSettingsSchema = z.strictObject({
  name: nullableText,
  address: nullableText,
  phone: nullableText,
  ntn: nullableText,
  strn: nullableText,
  headerEn: nullableText,
  headerUr: nullableText,
  footerEn: nullableText,
  footerUr: nullableText,
});

const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const hostname =
  /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

const hostSchema = z
  .string()
  .trim()
  .min(1, "Host is required.")
  .max(253, "Host is up to 253 characters.")
  .regex(hostname, "Host is an IP address or a name.")
  .refine(
    (value) => !ipv4.test(value) || value.split(".").every((part) => Number(part) <= 255),
    "Host is an IP address or a name.",
  );

export const printerConnectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("windows"),
    name: z.string().trim().min(1, "Pick a printer.").max(256),
  }),
  z.strictObject({
    kind: z.literal("network"),
    host: hostSchema,
    port: z.int().min(1, "Port is 1 to 65535.").max(65535, "Port is 1 to 65535."),
  }),
]);

export const printerSettingsSchema = z.strictObject({
  connection: printerConnectionSchema,
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  printMode: z.enum(printModes),
});

export const windowsPrinterSchema = z.strictObject({
  name: z.string(),
  displayName: z.string(),
  isDefault: z.boolean(),
});

export const windowsPrintersSchema = z.array(windowsPrinterSchema);

export type ReceiptSettings = z.infer<typeof receiptSettingsSchema>;
export type ReceiptSettingsInput = z.input<typeof receiptSettingsInputSchema>;
export type PrinterConnection = z.infer<typeof printerConnectionSchema>;
export type PrinterSettings = z.infer<typeof printerSettingsSchema>;
export type WindowsPrinter = z.infer<typeof windowsPrinterSchema>;
