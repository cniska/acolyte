import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { isoDateTimeSchema, nowIso } from "./datetime";

export const importLedgerEntrySchema = z.object({
  importedAt: isoDateTimeSchema,
  exchanges: z.number().int().min(0),
});
export type ImportLedgerEntry = z.infer<typeof importLedgerEntrySchema>;

export const importLedgerSchema = z.object({
  version: z.literal(1),
  sessions: z.record(z.string(), importLedgerEntrySchema),
});
export type ImportLedger = z.infer<typeof importLedgerSchema>;

export function emptyImportLedger(): ImportLedger {
  return { version: 1, sessions: {} };
}

export function importLedgerKey(source: string, sourceSessionId: string): string {
  return `${source}:${sourceSessionId}`;
}

/** How many of a source session's exchanges an earlier import already handed to the distiller. */
export function consumedExchanges(ledger: ImportLedger, source: string, sourceSessionId: string): number {
  return ledger.sessions[importLedgerKey(source, sourceSessionId)]?.exchanges ?? 0;
}

export function markConsumed(
  ledger: ImportLedger,
  source: string,
  sourceSessionId: string,
  exchanges: number,
): ImportLedger {
  return {
    ...ledger,
    sessions: {
      ...ledger.sessions,
      [importLedgerKey(source, sourceSessionId)]: { importedAt: nowIso(), exchanges },
    },
  };
}

/**
 * A missing ledger is a first import; an unreadable one is not, and reading it as empty would
 * re-distill every session it recorded, which is the churn the ledger exists to prevent.
 */
export async function readImportLedger(path: string): Promise<ImportLedger> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return emptyImportLedger();
  }
  return importLedgerSchema.parse(JSON.parse(raw));
}

export async function writeImportLedger(path: string, ledger: ImportLedger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}
