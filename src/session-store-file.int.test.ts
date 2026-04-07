import { sessionStoreContractTests } from "./session-store-contract.test-suite";
import { createFileSessionStore } from "./storage";
import { tempDb } from "./test-utils";

const { create, cleanup } = tempDb("acolyte-session-", (path) => createFileSessionStore(path));
sessionStoreContractTests("File", { create, cleanup });
