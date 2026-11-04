import { describe, expect, it } from "vitest";
import { weightedAverageCostPaisa } from "./average-cost";

const avco = (
  onHandMilli: number,
  averageCostPaisa: number,
  incomingQtyMilli: number,
  incomingCostPaisa: number,
) =>
  weightedAverageCostPaisa({ onHandMilli, averageCostPaisa, incomingQtyMilli, incomingCostPaisa });

describe("weightedAverageCostPaisa", () => {
  it("returns the incoming cost when nothing is on hand", () => {
    expect(avco(0, 100, 1000, 120)).toBe(120);
  });

  it("returns the incoming cost when on-hand is negative", () => {
    expect(avco(-5000, 100, 10000, 120)).toBe(120);
  });

  it("averages by quantity", () => {
    expect(avco(1000, 100, 1000, 200)).toBe(150);
  });

  it("rounds down below half a paisa", () => {
    expect(avco(3000, 100, 1000, 101)).toBe(100);
  });

  it("rounds half up", () => {
    expect(avco(1000, 100, 1000, 101)).toBe(101);
  });

  it("handles weighed quantities", () => {
    expect(avco(1250, 100, 750, 200)).toBe(138);
  });

  it("keeps precision for large values", () => {
    expect(avco(1_000_000_000, 99_999_999, 1_000_000_000, 100_000_000)).toBe(100_000_000);
  });

  it("leaves the average unchanged for zero or negative incoming quantity", () => {
    expect(avco(1000, 100, 0, 500)).toBe(100);
    expect(avco(1000, 100, -500, 500)).toBe(100);
  });

  it("averages down with a zero incoming cost and returns an integer", () => {
    const result = avco(1000, 100, 1000, 0);
    expect(result).toBe(50);
    expect(Number.isInteger(avco(3000, 101, 7000, 0))).toBe(true);
  });
});
