import { asc } from "drizzle-orm";
import type { VendoraDatabase } from "./client";
import { stores, terminals } from "./schema";

export function seedStoreAndTerminal(database: VendoraDatabase): void {
  database.db.transaction((tx) => {
    const store = tx.select().from(stores).orderBy(asc(stores.id)).limit(1).get();
    const storeId = store?.id ?? tx.insert(stores).values({}).returning({ id: stores.id }).get().id;

    if (!tx.select({ id: terminals.id }).from(terminals).limit(1).get()) {
      tx.insert(terminals).values({ storeId, code: "T1" }).run();
    }
  });
}
