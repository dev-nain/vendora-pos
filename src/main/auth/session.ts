import type { UserRole } from "../db/schema";

export interface Session {
  userId: string;
  role: UserRole;
  storeId: string;
}
