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
