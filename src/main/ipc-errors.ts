import { ipcErrorMessages } from "@shared/ipc";
import { ForbiddenError } from "./auth/errors";

export function toIpcError(error: unknown): unknown {
  return error instanceof ForbiddenError ? new Error(ipcErrorMessages.forbidden) : error;
}
