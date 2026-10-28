import { describe, expect, it, vi } from "vitest";
import { createActivityReporter } from "./activity-report";

describe("createActivityReporter", () => {
  it("reports on the leading edge and at most once per interval", () => {
    const report = vi.fn<() => void>();
    let time = 10_000;
    const touch = createActivityReporter(report, 1000, () => time);

    touch();
    touch();
    time += 999;
    touch();
    expect(report).toHaveBeenCalledTimes(1);

    time += 1;
    touch();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("reports the first call even when the clock starts at zero", () => {
    const report = vi.fn<() => void>();
    const touch = createActivityReporter(report, 1000, () => 0);

    touch();

    expect(report).toHaveBeenCalledTimes(1);
  });
});
