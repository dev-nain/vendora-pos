import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(4, "Password must be 4–5 characters")
  .max(5, "Password must be 4–5 characters");

export const pinSchema = z.string().regex(/^[0-9]{4,6}$/, "PIN must be 4–6 digits");

export type Password = z.infer<typeof passwordSchema>;
export type Pin = z.infer<typeof pinSchema>;
