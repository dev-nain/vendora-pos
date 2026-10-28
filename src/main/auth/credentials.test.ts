import { describe, expect, it } from "vitest";
import { hashCredential, verifyCredential } from "./credentials";

describe("credentials", () => {
  it("verifies the right secret and rejects a wrong one", async () => {
    const hash = await hashCredential("1234");
    expect(await verifyCredential(hash, "1234")).toBe(true);
    expect(await verifyCredential(hash, "abcd")).toBe(false);
  });

  it("produces salted argon2id hashes with the fixed parameters", async () => {
    const first = await hashCredential("1234");
    const second = await hashCredential("1234");
    expect(first.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(first).not.toBe(second);
  });

  it.each(["", "not-a-hash"])("returns false for malformed hash %j", async (bad) => {
    expect(await verifyCredential(bad, "1234")).toBe(false);
  });
});
