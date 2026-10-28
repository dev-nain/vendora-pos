import type { SafeUser } from "@shared/auth";

const labels: Record<SafeUser["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
};

export const roleLabel = (role: SafeUser["role"]): string => labels[role];
