import type { Permission } from "./policy";

export class ForbiddenError extends Error {
  readonly code = "forbidden";
  readonly permission: Permission;

  constructor(permission: Permission) {
    // Fixed text so no user data can leak through the message.
    super("Forbidden");
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

export class ApprovalError extends Error {
  readonly code = "approval-invalid";

  constructor() {
    super("Approval invalid");
    this.name = "ApprovalError";
  }
}

export class UnauthenticatedError extends Error {
  readonly code = "unauthenticated";

  constructor() {
    super("Unauthenticated");
    this.name = "UnauthenticatedError";
  }
}
