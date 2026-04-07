import { createSqliteMemoryStore } from "./memory-store";
import { memoryStoreContractTests } from "./memory-store-contract.test-suite";
import { tempDb } from "./test-utils";

const { create, cleanup } = tempDb("acolyte-memory-", createSqliteMemoryStore);
memoryStoreContractTests("SQLite", { create, cleanup });
