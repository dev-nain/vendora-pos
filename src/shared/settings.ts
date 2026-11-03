import { z } from "zod";

export const autoLockMinutesSchema = z.int().min(1).max(60).nullable();

export const autoLockInputSchema = z.strictObject({ minutes: autoLockMinutesSchema });

export const autoLockSettingSchema = z.strictObject({ minutes: autoLockMinutesSchema });

export const miscItemInputSchema = z.strictObject({ enabled: z.boolean() });

export const miscItemSettingSchema = z.strictObject({ enabled: z.boolean() });

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

export type AutoLockInput = z.infer<typeof autoLockInputSchema>;
export type AutoLockSetting = z.infer<typeof autoLockSettingSchema>;
export type ScalePrefixesInput = z.infer<typeof scalePrefixesInputSchema>;
export type ScalePrefixesSetting = z.infer<typeof scalePrefixesSettingSchema>;
export type MiscItemInput = z.infer<typeof miscItemInputSchema>;
export type MiscItemSetting = z.infer<typeof miscItemSettingSchema>;
