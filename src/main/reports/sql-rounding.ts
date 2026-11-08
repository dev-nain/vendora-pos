import { sql, type SQL } from "drizzle-orm";

// SQLite integer `/` truncates toward zero, so the sign is split out for half-up rounding.
export function halfUpDiv(expr: SQL, divisor: number): SQL {
  if (!Number.isInteger(divisor) || divisor <= 0) throw new Error("Divisor must be positive");
  const d = sql.raw(String(divisor));
  return sql`(CASE WHEN ${expr} < 0 THEN -((-(${expr}) * 2 + ${d}) / (2 * ${d})) ELSE ((${expr}) * 2 + ${d}) / (2 * ${d}) END)`;
}
