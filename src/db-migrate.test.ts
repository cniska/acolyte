import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { type Migration, migrateUp } from "./db-migrate";

function createTestDb(): Database {
  return new Database(":memory:");
}

const migrations: Migration[] = [
  {
    version: 1,
    up: "CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
  },
  {
    version: 2,
    up: "ALTER TABLE items ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
  },
];

describe("migrateUp", () => {
  test("runs all migrations on empty database", () => {
    const db = createTestDb();
    const count = migrateUp(db, migrations);
    expect(count).toBe(2);
    const row = db.prepare<{ version: number }, []>("SELECT version FROM schema_version").get();
    expect(row?.version).toBe(2);
  });

  test("skips already-applied migrations", () => {
    const db = createTestDb();
    migrateUp(db, migrations);
    const count = migrateUp(db, migrations);
    expect(count).toBe(0);
  });

  test("runs only pending migrations", () => {
    const db = createTestDb();
    migrateUp(db, [migrations[0]]);
    const count = migrateUp(db, migrations);
    expect(count).toBe(1);
    const row = db.prepare<{ version: number }, []>("SELECT version FROM schema_version").get();
    expect(row?.version).toBe(2);
  });

  test("creates usable tables", () => {
    const db = createTestDb();
    migrateUp(db, migrations);
    db.run("INSERT INTO items (id, name) VALUES ('a', 'test')");
    const row = db.prepare<{ id: string; name: string; status: string }, []>("SELECT * FROM items").get();
    expect(row).toEqual({ id: "a", name: "test", status: "active" });
  });
});
