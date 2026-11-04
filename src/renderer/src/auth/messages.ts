import { ipcErrorMessages } from "@shared/ipc";

export const serviceErrorMessage = "Couldn't reach the app service. Try again.";

export const isSessionError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes(ipcErrorMessages.unauthenticated);
