import { z } from "zod";

export const autoLockMinutesSchema = z.int().min(1).max(60).nullable();

export const autoLockInputSchema = z.strictObject({ minutes: autoLockMinutesSchema });

export const autoLockSettingSchema = z.strictObject({ minutes: autoLockMinutesSchema });

export type AutoLockInput = z.infer<typeof autoLockInputSchema>;
export type AutoLockSetting = z.infer<typeof autoLockSettingSchema>;
