export class UnauthenticatedError extends Error {
  readonly code = "unauthenticated";

  constructor() {
    super("Unauthenticated");
    this.name = "UnauthenticatedError";
  }
}
