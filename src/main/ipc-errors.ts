import { ipcErrorMessages } from "../shared/ipc";
import { UnauthenticatedError } from "./auth/errors";

export function toIpcError(error: unknown): unknown {
  if (error instanceof UnauthenticatedError) return new Error(ipcErrorMessages.unauthenticated);
  return error;
}
