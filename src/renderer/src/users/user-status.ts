import type { ManagedUser } from "@shared/users";

export function userStatusLabels(user: Pick<ManagedUser, "isActive" | "pinLocked">): string[] {
  const labels = [user.isActive ? "Active" : "Inactive"];
  if (user.isActive && user.pinLocked) labels.push("PIN locked");
  return labels;
}
