import { z } from "zod";
import type { VendoraDatabase } from "../db/client";
import { getCashierDiscountLimitBps } from "../settings/store-settings";
import { discountDecision, type GatedDecision } from "./policy";
import type { Session } from "./session";

const discountBpsSchema = z.number().int().min(0).max(10000);

export function checkDiscount(
  database: VendoraDatabase,
  session: Session,
  discountBps: number,
): GatedDecision {
  const bps = discountBpsSchema.parse(discountBps);
  return discountDecision(session.role, bps, getCashierDiscountLimitBps(database, session.storeId));
}
