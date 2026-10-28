import { z } from "zod";

export const appInfoSchema = z.object({ version: z.string() });

export type AppInfo = z.infer<typeof appInfoSchema>;

export const ipcChannels = {
  appGetInfo: "app:get-info",
} as const;

export const ipcErrorMessages = {
  forbidden: "You don't have permission to do this. Ask the owner or a manager.",
} as const;

export interface VendoraApi {
  app: {
    getInfo: () => Promise<AppInfo>;
  };
}
