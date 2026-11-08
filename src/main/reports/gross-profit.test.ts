import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { divRoundHalfUp } from "../../shared/rounding";
import { halfUpDiv, marginBps } from "./gross-profit";

describe("marginBps", () => {
  it.each([
    [4000, 10000, 4000],
    [1, 3, 3333],
    [2, 3, 6667],
    [1, 20000, 1],
    [1, 80000, 0],
    [-1, 20000, -1],
    [-40, -100, 4000],
  ])("margin of %i on %i is %i bps", (profit, net, expected) => {
    const result = marginBps(profit, net);
    expect(result).toBe(expected);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("has no margin without net sales", () => {
    expect(marginBps(0, 0)).toBeNull();
    expect(marginBps(5, 0)).toBeNull();
  });

  it("rejects non-integers", () => {
    expect(() => marginBps(1.5, 100)).toThrow();
    expect(() => marginBps(1, 100.5)).toThrow();
  });
});

describe("halfUpDiv", () => {
  const dialect = new SQLiteSyncDialect();
  const sqlite = new Database(":memory:");

  const inSqlite = (value: number, divisor: number): number => {
    const query = dialect.sqlToQuery(
      sql`select ${halfUpDiv(sql.raw(String(value)), divisor)} as result`,
    );
    return (sqlite.prepare(query.sql).get(...query.params) as { result: number }).result;
  };

  it.each([
    [1500, 1000],
    [-1500, 1000],
    [1499, 1000],
    [-1499, 1000],
    [500, 1000],
    [-500, 1000],
    [499, 1000],
    [-499, 1000],
    [0, 1000],
    [2500, 1000],
    [-2500, 1000],
    [12000 * 8000, 1000],
  ])("matches divRoundHalfUp for %i / %i", (value, divisor) => {
    expect(inSqlite(value, divisor)).toBe(divRoundHalfUp(BigInt(value), BigInt(divisor)));
  });
});
