export class UnauthenticatedError extends Error {
  readonly code = "unauthenticated";

  constructor() {
    super("Unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

export class RecoveryUnavailableError extends Error {
  readonly code = "recovery-unavailable";

  constructor() {
    super("Recovery unavailable");
    this.name = "RecoveryUnavailableError";
  }
}
