import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceCommand, WorkspaceProfile } from "./workspace-profile";

export function fileExists(workspace: string, name: string): boolean {
  return existsSync(join(workspace, name));
}

export function readJson(workspace: string, name: string): Record<string, unknown> | null {
  try {
    const path = join(workspace, name);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readText(workspace: string, name: string): string | null {
  try {
    const path = join(workspace, name);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export type WorkspaceResolverResult = {
  lintCommand?: WorkspaceCommand;
  verifyCommand?: WorkspaceCommand;
  lineWidth?: number;
};

export type WorkspaceResolver = {
  id: string;
  resolve: (workspace: string) => WorkspaceResolverResult | null;
};

export type EcosystemDetector = {
  id: string;
  match: (workspace: string) => boolean;
  resolvers: readonly WorkspaceResolver[];
};

function runResolvers(
  ecosystem: string,
  resolvers: readonly WorkspaceResolver[],
  workspace: string,
): WorkspaceProfile | null {
  let lintCommand: WorkspaceCommand | undefined;
  let verifyCommand: WorkspaceCommand | undefined;
  let lineWidth: number | undefined;

  for (const resolver of resolvers) {
    const result = resolver.resolve(workspace);
    if (!result) continue;
    if (!lintCommand && result.lintCommand) lintCommand = result.lintCommand;
    if (!verifyCommand && result.verifyCommand) verifyCommand = result.verifyCommand;
    if (!lineWidth && result.lineWidth) lineWidth = result.lineWidth;
  }

  if (!lintCommand && !verifyCommand) return null;
  return { ecosystem, lintCommand, verifyCommand, lineWidth };
}

function resolvePackageManager(workspace: string): string {
  if (fileExists(workspace, "bun.lock") || fileExists(workspace, "bun.lockb")) return "bun";
  if (fileExists(workspace, "pnpm-lock.yaml")) return "pnpm";
  if (fileExists(workspace, "yarn.lock")) return "yarn";
  if (fileExists(workspace, "package-lock.json")) return "npm";
  return "bun";
}

const editorconfigResolver: WorkspaceResolver = {
  id: "editorconfig",
  resolve(workspace) {
    const text = readText(workspace, ".editorconfig");
    if (!text) return null;
    const match = text.match(/max_line_length\s*=\s*(\d+)/);
    return match ? { lineWidth: Number(match[1]) } : null;
  },
};

const prettierResolver: WorkspaceResolver = {
  id: "prettier",
  resolve(workspace) {
    for (const name of [".prettierrc", ".prettierrc.json"]) {
      const raw = readJson(workspace, name);
      if (!raw) continue;
      const width = (raw as { printWidth?: unknown }).printWidth;
      if (typeof width === "number" && width > 0) return { lineWidth: width };
    }
    return null;
  },
};

const biomeResolver: WorkspaceResolver = {
  id: "biome",
  resolve(workspace) {
    for (const name of ["biome.json", "biome.jsonc"]) {
      const raw = readJson(workspace, name);
      if (!raw) continue;
      const width = (raw as { formatter?: { lineWidth?: unknown } }).formatter?.lineWidth;
      return {
        lintCommand: { bin: "bunx", args: ["biome", "check"] },
        lineWidth: typeof width === "number" && width > 0 ? width : undefined,
      };
    }
    return null;
  },
};

const eslintResolver: WorkspaceResolver = {
  id: "eslint",
  resolve(workspace) {
    const configs = [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.ts",
      ".eslintrc",
      ".eslintrc.json",
      ".eslintrc.js",
    ];
    for (const name of configs) {
      if (fileExists(workspace, name)) return { lintCommand: { bin: "npx", args: ["eslint"] } };
    }
    return null;
  },
};

const packageJsonVerifyResolver: WorkspaceResolver = {
  id: "package-json-verify",
  resolve(workspace) {
    const pkg = readJson(workspace, "package.json");
    if (!pkg) return null;
    const scripts = (typeof pkg.scripts === "object" && pkg.scripts !== null ? pkg.scripts : {}) as Record<
      string,
      unknown
    >;
    const pm = resolvePackageManager(workspace);
    for (const name of ["verify", "test", "check"]) {
      if (typeof scripts[name] === "string") return { verifyCommand: { bin: pm, args: ["run", name] } };
    }
    return null;
  },
};

const denoResolver: WorkspaceResolver = {
  id: "deno",
  resolve(workspace) {
    for (const name of ["deno.json", "deno.jsonc"]) {
      const raw = readJson(workspace, name);
      if (!raw) continue;
      const width = (raw as { fmt?: { lineWidth?: unknown } }).fmt?.lineWidth;
      return {
        lintCommand: { bin: "deno", args: ["lint"] },
        verifyCommand: { bin: "deno", args: ["test"] },
        lineWidth: typeof width === "number" && width > 0 ? width : undefined,
      };
    }
    return null;
  },
};

const typescriptEcosystem: EcosystemDetector = {
  id: "typescript",
  match: (workspace) => fileExists(workspace, "package.json") || fileExists(workspace, "deno.json"),
  resolvers: [
    biomeResolver,
    eslintResolver,
    denoResolver,
    packageJsonVerifyResolver,
    editorconfigResolver,
    prettierResolver,
  ],
};

const ruffResolver: WorkspaceResolver = {
  id: "ruff",
  resolve(workspace) {
    if (fileExists(workspace, "ruff.toml")) return { lintCommand: { bin: "ruff", args: ["check"] } };
    const text = readText(workspace, "pyproject.toml");
    if (text?.includes("[tool.ruff]")) return { lintCommand: { bin: "ruff", args: ["check"] } };
    return null;
  },
};

const pytestResolver: WorkspaceResolver = {
  id: "pytest",
  resolve(workspace) {
    if (
      fileExists(workspace, "pyproject.toml") ||
      fileExists(workspace, "setup.py") ||
      fileExists(workspace, "setup.cfg")
    )
      return { verifyCommand: { bin: "pytest", args: [] } };
    return null;
  },
};

const pythonEcosystem: EcosystemDetector = {
  id: "python",
  match: (workspace) =>
    fileExists(workspace, "pyproject.toml") || fileExists(workspace, "setup.py") || fileExists(workspace, "ruff.toml"),
  resolvers: [ruffResolver, pytestResolver, editorconfigResolver],
};

const goVetResolver: WorkspaceResolver = {
  id: "go-vet",
  resolve() {
    return {
      lintCommand: { bin: "go", args: ["vet", "./..."] },
      verifyCommand: { bin: "go", args: ["test", "./..."] },
    };
  },
};

const goEcosystem: EcosystemDetector = {
  id: "go",
  match: (workspace) => fileExists(workspace, "go.mod"),
  resolvers: [goVetResolver, editorconfigResolver],
};

const cargoClippyResolver: WorkspaceResolver = {
  id: "cargo-clippy",
  resolve() {
    return {
      lintCommand: { bin: "cargo", args: ["clippy", "--all-targets", "--", "-D", "warnings"] },
      verifyCommand: { bin: "cargo", args: ["test"] },
    };
  },
};

const rustEcosystem: EcosystemDetector = {
  id: "rust",
  match: (workspace) => fileExists(workspace, "Cargo.toml"),
  resolvers: [cargoClippyResolver, editorconfigResolver],
};

export const ecosystems: readonly EcosystemDetector[] = [
  typescriptEcosystem,
  pythonEcosystem,
  goEcosystem,
  rustEcosystem,
];

export function detectWorkspaceProfile(workspace: string): WorkspaceProfile | null {
  for (const eco of ecosystems) {
    if (!eco.match(workspace)) continue;
    return runResolvers(eco.id, eco.resolvers, workspace);
  }
  return null;
}
