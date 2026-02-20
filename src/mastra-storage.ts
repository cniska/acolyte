import { InMemoryStore } from "@mastra/core/storage";
import { PostgresStore } from "@mastra/pg";
import { env } from "./env";

const databaseUrl = env.DATABASE_URL?.trim();

export const mastraStorageMode = databaseUrl ? "postgres" : "in-memory";

export const mastraStorage = databaseUrl
  ? new PostgresStore({ id: "acolyte-storage", connectionString: databaseUrl })
  : new InMemoryStore();
