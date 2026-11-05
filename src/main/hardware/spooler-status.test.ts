import { describe, expect, it } from "vitest";
import { interpretSpoolerStatus, isJobDone } from "./spooler-status";

const ready = { state: "ready" };
const failed = { state: "failed" };

describe("interpretSpoolerStatus", () => {
  it("is ready for an idle printer with no job", () => {
    expect(interpretSpoolerStatus(0, 0, null)).toEqual(ready);
  });

  it("stays ready while the printer is busy or printing", () => {
    expect(interpretSpoolerStatus(0x200 | 0x400 | 0x4000, 0, null)).toEqual(ready);
    expect(interpretSpoolerStatus(0, 0, 0x8 | 0x10)).toEqual(ready);
  });

  it.each([
    ["paused", 0x1],
    ["error", 0x2],
    ["paper jam", 0x8],
    ["paper out", 0x10],
    ["paper problem", 0x40],
    ["offline", 0x80],
    ["not available", 0x1000],
    ["user intervention", 0x100000],
    ["door open", 0x400000],
  ])("fails when the printer is %s", (_name, bit) => {
    expect(interpretSpoolerStatus(bit, 0, null)).toEqual(failed);
  });

  it("fails when the printer is set to work offline", () => {
    expect(interpretSpoolerStatus(0, 0x400, null)).toEqual(failed);
    expect(interpretSpoolerStatus(0, 0x200, null)).toEqual(ready);
  });

  it.each([
    ["error", 0x2],
    ["offline", 0x20],
    ["paper out", 0x40],
    ["blocked", 0x200],
    ["user intervention", 0x400],
  ])("fails when the job is %s", (_name, bit) => {
    expect(interpretSpoolerStatus(0, 0, bit)).toEqual(failed);
  });
});

describe("isJobDone", () => {
  it("is true once printed or complete", () => {
    expect(isJobDone(0x80)).toBe(true);
    expect(isJobDone(0x1000)).toBe(true);
    expect(isJobDone(0x10)).toBe(false);
    expect(isJobDone(0)).toBe(false);
  });
});
