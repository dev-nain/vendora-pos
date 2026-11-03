import { z } from "zod";

export const autoLockMinutesSchema = z.int().min(1).max(60).nullable();

export const autoLockInputSchema = z.strictObject({ minutes: autoLockMinutesSchema });

export const autoLockSettingSchema = z.strictObject({ minutes: autoLockMinutesSchema });

export const miscItemInputSchema = z.strictObject({ enabled: z.boolean() });

export const miscItemSettingSchema = z.strictObject({ enabled: z.boolean() });

export type AutoLockInput = z.infer<typeof autoLockInputSchema>;
export type AutoLockSetting = z.infer<typeof autoLockSettingSchema>;
export type MiscItemInput = z.infer<typeof miscItemInputSchema>;
export type MiscItemSetting = z.infer<typeof miscItemSettingSchema>;
