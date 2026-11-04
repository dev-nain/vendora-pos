import { z } from "zod";

export const printerKinds = ["none", "windows", "network"] as const;
export const printModes = ["print", "ask", "off"] as const;
export type PaperWidthMm = 58 | 80;

export const miscItemInputSchema = z.strictObject({ enabled: z.boolean() });

export const miscItemSettingSchema = z.strictObject({ enabled: z.boolean() });

const warnPaisaSchema = z.int().min(0).max(100_000_000);

export const shiftVarianceInputSchema = z.strictObject({ warnPaisa: warnPaisaSchema });

export const shiftVarianceSettingSchema = z.strictObject({ warnPaisa: warnPaisaSchema });

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
