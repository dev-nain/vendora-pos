import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { divRoundHalfUp } from "../../shared/rounding";
import { createCheckoutKit } from "../services/checkout-test-kit";
import { halfUpDiv } from "./sql-rounding";

describe("halfUpDiv", () => {
  const kit = createCheckoutKit();
  afterAll(() => kit.close());

  const cases: [number, number][] = [
    [0, 1000],
    [499, 1000],
    [500, 1000],
    [501, 1000],
    [1500, 1000],
    [2500, 1000],
    [-499, 1000],
    [-500, 1000],
    [-501, 1000],
    [-1500, 1000],
    [-2500, 1000],
    [12_500, 1000],
    [-12_500, 1000],
    [7, 2],
    [-7, 2],
    [5, 10],
    [-5, 10],
    [3_000_000_000, 1000],
  ];

  it.each(cases)("matches divRoundHalfUp for %i / %i", (numerator, divisor) => {
    const [result] = kit.database.db.all<{ value: number }>(
      sql`SELECT ${halfUpDiv(sql.raw(String(numerator)), divisor)} AS value`,
    );
    expect(result?.value).toBe(divRoundHalfUp(BigInt(numerator), BigInt(divisor)));
  });
});
