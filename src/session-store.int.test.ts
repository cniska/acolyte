import { sessionStoreContractTests } from "./session-store-contract.test-suite";
import { createFileSessionStore } from "./session-store";
import { tempDb } from "./test-utils";

const { create, cleanup } = tempDb("acolyte-session-", (path) => createFileSessionStore(path));
sessionStoreContractTests("File", { create, cleanup });
