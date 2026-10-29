import { ipcErrorMessages } from "../shared/ipc";
import {
  ApprovalError,
  ForbiddenError,
  SessionLockedError,
  UnauthenticatedError,
} from "./auth/errors";

export function toIpcError(error: unknown): unknown {
  if (error instanceof ForbiddenError) return new Error(ipcErrorMessages.forbidden);
  if (error instanceof UnauthenticatedError) return new Error(ipcErrorMessages.unauthenticated);
  if (error instanceof SessionLockedError) return new Error(ipcErrorMessages.locked);
  if (error instanceof ApprovalError) return new Error(ipcErrorMessages.approvalInvalid);
  return error;
}
