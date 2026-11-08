import { ipcErrorMessages } from "../shared/ipc";
import { RecoveryUnavailableError, UnauthenticatedError } from "./auth/errors";

export function toIpcError(error: unknown): unknown {
  if (error instanceof UnauthenticatedError) return new Error(ipcErrorMessages.unauthenticated);
  if (error instanceof RecoveryUnavailableError) {
    return new Error(ipcErrorMessages.recoveryUnavailable);
  }
  return error;
}
