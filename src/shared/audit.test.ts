import { describe, expect, it } from "vitest";
import { auditActions, auditListQuerySchema } from "./audit";

const uuid = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const parse = (input: unknown) => auditListQuerySchema.safeParse(input).success;

describe("auditListQuerySchema", () => {
  it("accepts an empty object and every filter together", () => {
    expect(parse({})).toBe(true);
    expect(
      parse({
        userId: uuid,
        action: "login",
        from: "2026-01-01",
        to: "2026-01-31",
        before: { createdAt: "2026-01-05T10:00:00.000Z", id: uuid },
      }),
    ).toBe(true);
  });

  it("refuses unknown keys, bad values and the retired void action", () => {
    expect(parse({ sort: "asc" })).toBe(false);
    expect(parse({ userId: "nope" })).toBe(false);
    expect(parse({ action: "hack" })).toBe(false);
    expect(parse({ action: "void" })).toBe(false);
    expect(parse({ from: "01/02/2026" })).toBe(false);
    expect(parse({ to: "2026-13-40" })).toBe(false);
  });

  it("refuses a malformed cursor", () => {
    expect(parse({ before: { createdAt: "yesterday", id: uuid } })).toBe(false);
    expect(parse({ before: { createdAt: "2026-01-05T10:00:00.000Z", id: "x" } })).toBe(false);
    expect(parse({ before: { createdAt: "2026-01-05T10:00:00.000Z", id: uuid, extra: 1 } })).toBe(
      false,
    );
  });

  it("refuses from after to and accepts equal days", () => {
    expect(parse({ from: "2026-02-01", to: "2026-01-31" })).toBe(false);
    expect(parse({ from: "2026-02-01", to: "2026-02-01" })).toBe(true);
  });

  it("has no void action", () => {
    expect(auditActions).not.toContain("void");
  });
});
