import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime } from "./date-time";

describe("formatDateTime", () => {
  it("shows Asia/Karachi time with a lower-case am/pm", () => {
    expect(formatDateTime("2026-10-27T11:05:00.000Z")).toBe("27 Oct 2026, 4:05 pm");
  });

  it("rolls over to the next day for a late UTC time", () => {
    expect(formatDateTime("2026-10-27T23:05:00.000Z")).toBe("28 Oct 2026, 4:05 am");
  });
});

describe("formatTime", () => {
  it("shows only the time", () => {
    expect(formatTime("2026-10-27T11:05:00.000Z")).toBe("4:05 pm");
    expect(formatTime("2026-10-27T23:05:00.000Z")).toBe("4:05 am");
  });
});
