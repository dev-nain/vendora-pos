import type { LoginUser } from "@shared/auth";
import { gatedActionDecision, type GatedAction } from "../../../shared/gated-actions";

export function approverChoices(users: LoginUser[], action: GatedAction): LoginUser[] {
  return users.filter((user) => gatedActionDecision(user.role, action) === "allowed");
}
