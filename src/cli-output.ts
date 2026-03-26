import { alignCols } from "./chat-format";

export type CliOutputOptions = {
  verbose?: boolean;
};

export type CliOutput = {
  readonly verbose: boolean;
  addRow: (data: Record<string, string | undefined>) => void;
  addTable: (rows: Record<string, string | undefined>[], labels?: Record<string, string>) => void;
  addHeader: (text: string) => void;
  addSeparator: () => void;
  render: () => string;
};

function renderKvPairs(data: Record<string, string | undefined>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

export function createTextOutput(options?: CliOutputOptions): CliOutput {
  const sections: string[] = [];

  return {
    verbose: options?.verbose ?? false,
    addRow: (data) => sections.push(renderKvPairs(data)),
    addTable: (rows, labels) => {
      if (rows.length === 0) return;
      const keys = Object.keys(rows[0]);
      const dataRows = rows.map((row) => keys.map((k) => row[k] ?? ""));
      const tableRows = labels ? [keys.map((k) => labels[k] ?? k), ...dataRows] : dataRows;
      for (const line of alignCols(tableRows)) sections.push(line);
    },
    addHeader: (text) => sections.push(text),
    addSeparator: () => sections.push(""),
    render: () => sections.join("\n"),
  };
}

function stripUndefined(data: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function createJsonOutput(options?: CliOutputOptions): CliOutput {
  const lines: string[] = [];

  return {
    verbose: options?.verbose ?? false,
    addRow: (data) => lines.push(JSON.stringify(stripUndefined(data))),
    addTable: (rows) => {
      for (const row of rows) lines.push(JSON.stringify(stripUndefined(row)));
    },
    addHeader: () => {},
    addSeparator: () => {},
    render: () => lines.join("\n"),
  };
}
