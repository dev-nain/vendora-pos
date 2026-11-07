import { describe, expect, it, vi } from "vitest";
import type { ProductUnit } from "./products";
import {
  exportReportInputSchema,
  formatRangeLabel,
  formatReportCell,
  formatStoreDateTime,
  formatStoreDay,
  formatStoreTimeCsv,
  isNumericColumn,
  presetRange,
  reportRangeSchema,
  salesByDayColumns,
  storeDayBounds,
  storeDayOfBucket,
  storeToday,
  storeUtcOffsetMs,
  type ReportColumn,
} from "./reports";

const iso = (date: Date) => date.toISOString();
const at = (value: string) => new Date(value);
const within = (start: Date, end: Date, ms: number) => ms >= start.getTime() && ms < end.getTime();

describe("store day bounds", () => {
  const { start, end } = storeDayBounds({ from: "2026-11-01", to: "2026-11-07" });

  it("maps the inclusive range to the half-open UTC window", () => {
    expect(iso(start)).toBe("2026-10-31T19:00:00.000Z");
    expect(iso(end)).toBe("2026-11-07T19:00:00.000Z");
  });

  it("includes the first and last millisecond of the range and nothing around it", () => {
    expect(within(start, end, Date.parse("2026-10-31T19:00:00.000Z"))).toBe(true);
    expect(within(start, end, Date.parse("2026-11-07T18:59:59.999Z"))).toBe(true);
    expect(within(start, end, Date.parse("2026-11-07T19:00:00.000Z"))).toBe(false);
    expect(within(start, end, Date.parse("2026-10-31T18:59:59.999Z"))).toBe(false);
  });

  it("covers one day when from equals to", () => {
    const one = storeDayBounds({ from: "2026-02-28", to: "2026-02-28" });
    expect(iso(one.start)).toBe("2026-02-27T19:00:00.000Z");
    expect(iso(one.end)).toBe("2026-02-28T19:00:00.000Z");
  });
});

describe("presets", () => {
  it("changes the store day at 19:00Z", () => {
    expect(storeToday(at("2026-11-07T18:59:59.000Z"))).toBe("2026-11-07");
    expect(storeToday(at("2026-11-07T19:00:00.000Z"))).toBe("2026-11-08");
  });

  it("gives today and yesterday", () => {
    const now = at("2026-11-07T10:00:00.000Z");
    expect(presetRange("today", now)).toEqual({ from: "2026-11-07", to: "2026-11-07" });
    expect(presetRange("yesterday", now)).toEqual({ from: "2026-11-06", to: "2026-11-06" });
  });

  it("crosses a month start, a year end and a leap day", () => {
    expect(presetRange("yesterday", at("2026-03-01T10:00:00.000Z"))).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
    expect(presetRange("yesterday", at("2028-03-01T10:00:00.000Z"))).toEqual({
      from: "2028-02-29",
      to: "2028-02-29",
    });
    expect(presetRange("yesterday", at("2027-01-01T10:00:00.000Z"))).toEqual({
      from: "2026-12-31",
      to: "2026-12-31",
    });
    expect(presetRange("this-month", at("2026-12-31T10:00:00.000Z"))).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("starts the week on Sunday", () => {
    expect(presetRange("this-week", at("2026-11-08T10:00:00.000Z"))).toEqual({
      from: "2026-11-08",
      to: "2026-11-08",
    });
    expect(presetRange("this-week", at("2026-11-07T10:00:00.000Z"))).toEqual({
      from: "2026-11-01",
      to: "2026-11-07",
    });
    expect(presetRange("this-week", at("2027-01-02T10:00:00.000Z"))).toEqual({
      from: "2026-12-27",
      to: "2027-01-02",
    });
  });

  it("does not depend on the machine time zone", () => {
    try {
      for (const zone of ["UTC", "America/New_York"]) {
        vi.stubEnv("TZ", zone);
        const now = at("2026-11-07T19:00:00.000Z");
        expect(storeToday(now)).toBe("2026-11-08");
        expect(presetRange("this-week", now)).toEqual({ from: "2026-11-08", to: "2026-11-08" });
        expect(iso(storeDayBounds({ from: "2026-11-08", to: "2026-11-08" }).start)).toBe(
          "2026-11-07T19:00:00.000Z",
        );
        expect(formatStoreDay("2026-11-08")).toBe("8 Nov 2026");
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("store offset", () => {
  it("matches Asia/Karachi on one date in each month", () => {
    const karachi = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    for (let month = 0; month < 12; month += 1) {
      const instant = new Date(Date.UTC(2026, month, 15, 12, 0));
      const parts = Object.fromEntries(
        karachi.formatToParts(instant).map((part) => [part.type, part.value]),
      );
      const local = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
      );
      expect(local - instant.getTime()).toBe(storeUtcOffsetMs);
    }
  });

  it("turns a bucket back into its day", () => {
    const bucket = Math.floor(
      (Date.parse("2026-11-07T20:00:00.000Z") + storeUtcOffsetMs) / 86400000,
    );
    expect(storeDayOfBucket(bucket)).toBe("2026-11-08");
  });
});

describe("range schemas", () => {
  it("accepts a valid range and one day", () => {
    expect(reportRangeSchema.safeParse({ from: "2026-11-01", to: "2026-11-07" }).success).toBe(
      true,
    );
    expect(reportRangeSchema.safeParse({ from: "2026-11-01", to: "2026-11-01" }).success).toBe(
      true,
    );
  });

  it("refuses from after to, impossible dates and extra keys", () => {
    expect(reportRangeSchema.safeParse({ from: "2026-11-08", to: "2026-11-07" }).success).toBe(
      false,
    );
    expect(reportRangeSchema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(
      false,
    );
    expect(
      reportRangeSchema.safeParse({ from: "2026-11-01", to: "2026-11-07", extra: 1 }).success,
    ).toBe(false);
  });

  it("refuses an unknown export format and extra keys", () => {
    const range = { from: "2026-11-01", to: "2026-11-07" };
    expect(exportReportInputSchema.safeParse({ range, format: "csv" }).success).toBe(true);
    expect(exportReportInputSchema.safeParse({ range, format: "xlsx" }).success).toBe(false);
    expect(exportReportInputSchema.safeParse({ range, format: "pdf", extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("range labels", () => {
  it("prints one day or a range", () => {
    expect(formatRangeLabel({ from: "2026-11-01", to: "2026-11-07" })).toBe(
      "1 Nov 2026 – 7 Nov 2026",
    );
    expect(formatRangeLabel({ from: "2026-11-07", to: "2026-11-07" })).toBe("7 Nov 2026");
  });
});

describe("formatReportCell", () => {
  type Row = { a: string | number | null };
  type Spec =
    | {
        format:
          | "day"
          | "text"
          | "count"
          | "money"
          | "time"
          | "invoice"
          | "percent"
          | "unit"
          | "datetime";
      }
    | { format: "quantity"; unit: ProductUnit };
  const column = (spec: Spec): ReportColumn<Row> => ({ key: "a", label: "A", ...spec });

  it("formats each kind", () => {
    expect(formatReportCell(column({ format: "day" }), "2026-11-07")).toBe("7 Nov 2026");
    expect(formatReportCell(column({ format: "money" }), 12050)).toBe("Rs 120.50");
    expect(formatReportCell(column({ format: "money" }), 0)).toBe("Rs 0");
    expect(formatReportCell(column({ format: "count" }), 1234567)).toBe("1,234,567");
    expect(formatReportCell(column({ format: "text" }), "Tea")).toBe("Tea");
    expect(formatReportCell(column({ format: "quantity", unit: "kg" }), 2500)).toBe("2.500 kg");
    expect(formatReportCell(column({ format: "quantity", unit: "piece" }), 3000)).toBe("3 pcs");
  });

  it("shows an instant in store time", () => {
    expect(formatReportCell(column({ format: "time" }), "2026-11-07T10:04:00.000Z")).toBe(
      "7 Nov 2026, 15:04",
    );
    expect(formatReportCell(column({ format: "time" }), "2026-11-07T19:00:00.000Z")).toBe(
      "8 Nov 2026, 00:00",
    );
    expect(formatStoreTimeCsv("2026-11-07T10:04:00.000Z")).toBe("2026-11-07 15:04");
  });

  it("takes a quantity unit from the row", () => {
    const byRow: ReportColumn<{ a: number; unit: string }> = {
      key: "a",
      label: "A",
      format: "quantity",
      unitKey: "unit",
    };
    expect(formatReportCell(byRow, 2500, { unit: "kg" })).toBe("2.500 kg");
    expect(formatReportCell(byRow, -3000, { unit: "piece" })).toBe("−3 pcs");
  });

  it("shows an invoice as text", () => {
    expect(formatReportCell(column({ format: "invoice" }), "T1-000004")).toBe("T1-000004");
  });

  it("keeps the sign on negatives, even below one rupee", () => {
    expect(formatReportCell(column({ format: "money" }), -50)).toBe("−Rs 0.50");
    expect(formatReportCell(column({ format: "money" }), -12050)).toBe("−Rs 120.50");
    expect(formatReportCell(column({ format: "quantity", unit: "kg" }), -1500)).toBe("−1.500 kg");
    expect(formatReportCell(column({ format: "quantity", unit: "piece" }), -2000)).toBe("−2 pcs");
    expect(formatReportCell(column({ format: "count" }), -3)).toBe("−3");
  });

  it("marks time and invoice columns as not numeric", () => {
    expect(isNumericColumn(column({ format: "time" }))).toBe(false);
    expect(isNumericColumn(column({ format: "invoice" }))).toBe(false);
  });

  it("formats percent from basis points", () => {
    expect(formatReportCell(column({ format: "percent" }), 2345)).toBe("23.45%");
    expect(formatReportCell(column({ format: "percent" }), -500)).toBe("−5.00%");
    expect(formatReportCell(column({ format: "percent" }), 0)).toBe("0.00%");
    expect(formatReportCell(column({ format: "percent" }), 7)).toBe("0.07%");
    expect(formatReportCell(column({ format: "percent" }), -7)).toBe("−0.07%");
  });

  it("shows an empty cell for null in every format", () => {
    for (const format of ["day", "text", "count", "money", "percent"] as const)
      expect(formatReportCell(column({ format }), null)).toBe("—");
    expect(formatReportCell(column({ format: "quantity", unit: "kg" }), null)).toBe("—");
  });

  it("formats row-unit quantities by the row's own unit", () => {
    type UnitRow = { unit: ProductUnit; qty: number };
    const qty: ReportColumn<UnitRow> = {
      key: "qty",
      label: "Qty",
      format: "quantity",
      unitKey: "unit",
      bare: true,
    };
    expect(formatReportCell(qty, 12000, { unit: "piece", qty: 12000 })).toBe("12");
    expect(formatReportCell(qty, 1500, { unit: "kg", qty: 1500 })).toBe("1.500");
    expect(formatReportCell(qty, 250, { unit: "litre", qty: 250 })).toBe("0.250");
    expect(formatReportCell(qty, -1500, { unit: "kg", qty: -1500 })).toBe("−1.500");
    expect(formatReportCell(qty, -2000, { unit: "piece", qty: -2000 })).toBe("−2");
  });

  it("counts a row-unit quantity in pieces when the row has no known unit", () => {
    type UnitRow = { unit: string; qty: number };
    const qty: ReportColumn<UnitRow> = {
      key: "qty",
      label: "Qty",
      format: "quantity",
      unitKey: "unit",
      bare: true,
    };
    expect(formatReportCell(qty, 1000)).toBe("1");
    expect(formatReportCell(qty, 1000, { unit: "box", qty: 1000 })).toBe("1");
  });

  it("formats unit columns", () => {
    const unit: ReportColumn<{ a: string }> = { key: "a", label: "Unit", format: "unit" };
    expect(formatReportCell(unit, "piece")).toBe("pcs");
    expect(formatReportCell(unit, "kg")).toBe("kg");
    expect(formatReportCell(unit, "litre")).toBe("L");
  });

  it("formats date-times as Asia/Karachi store time", () => {
    const when: ReportColumn<{ a: string }> = { key: "a", label: "When", format: "datetime" };
    expect(formatReportCell(when, "2026-11-07T10:05:00.000Z")).toBe("7 Nov 2026, 3:05 pm");
    expect(formatReportCell(when, "2026-11-07T19:30:00.000Z")).toBe("8 Nov 2026, 12:30 am");
    expect(formatReportCell(when, "2026-11-07T07:00:00.000Z")).toBe("7 Nov 2026, 12:00 pm");
    expect(formatReportCell(when, "2026-11-06T18:59:00.000Z")).toBe("6 Nov 2026, 11:59 pm");
  });

  it("agrees with Intl for Asia/Karachi on dates either side of midnight UTC", () => {
    const intl = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    for (const instant of [
      "2026-01-01T00:00:00.000Z",
      "2026-03-31T18:59:59.000Z",
      "2026-03-31T19:00:00.000Z",
      "2026-12-31T23:59:00.000Z",
      "2026-07-15T07:07:00.000Z",
    ]) {
      const parts = intl.formatToParts(new Date(instant));
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((candidate) => candidate.type === type)?.value ?? "";
      const expected = `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
      expect(formatStoreDateTime(instant)).toBe(expected);
    }
  });

  it("marks unit and date-time columns as not numeric", () => {
    expect(isNumericColumn(column({ format: "unit" }))).toBe(false);
    expect(isNumericColumn(column({ format: "datetime" }))).toBe(false);
    expect(isNumericColumn(column({ format: "count" }))).toBe(true);
    expect(isNumericColumn(column({ format: "money" }))).toBe(true);
  });

  it("marks day and text columns as not numeric", () => {
    expect(salesByDayColumns.map(isNumericColumn)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});
