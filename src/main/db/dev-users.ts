import { sql } from "drizzle-orm";
import { hashCredential } from "../auth/credentials";
import type { VendoraDatabase } from "./client";
import { users } from "./schema";

export const devUsers = [
  {
    username: "owner",
    password: "ow123",
    pin: "1111",
    displayName: "Imran Qureshi",
  },
  {
    username: "manager",
    password: "mg123",
    pin: "2222",
    displayName: "Sana Malik",
  },
  {
    username: "cashier",
    password: "ca123",
    pin: "3333",
    displayName: "Bilal Ahmed",
  },
] as const;

export async function seedDevUsers(database: VendoraDatabase): Promise<void> {
  const { db } = database;
  const hashed = await Promise.all(
    devUsers.map(async (fixture) => ({
      fixture,
      passwordHash: await hashCredential(fixture.password),
      pinHash: await hashCredential(fixture.pin),
    })),
  );

  db.transaction((tx) => {
    for (const { fixture, passwordHash, pinHash } of hashed) {
      const exists = tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.username}) = lower(${fixture.username})`)
        .get();
      if (exists) continue;
      tx.insert(users)
        .values({
          username: fixture.username,
          displayName: fixture.displayName,
          passwordHash,
          pinHash,
        })
        .run();
    }
  });
}
