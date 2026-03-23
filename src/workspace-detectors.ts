import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceCommand, WorkspaceProfile } from "./workspace-profile";

export function fileExists(workspace: string, name: string): boolean {
  return existsSync(join(workspace, name));
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export function readJson(workspace: string, name: string): Record<string, unknown> | null {
  try {
    const path = join(workspace, name);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    return JSON.parse(name.endsWith("c") ? stripJsonComments(raw) : raw) as Record<string, unknown>;
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

function detectLineWidthFromEditorconfig(workspace: string): number | null {
  const text = readText(workspace, ".editorconfig");
  if (!text) return null;
  const match = text.match(/max_line_length\s*=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function packageRunner(pm: string): WorkspaceCommand {
  switch (pm) {
    case "bun":
      return { bin: "bunx", args: [] };
    case "pnpm":
      return { bin: "pnpx", args: [] };
    case "yarn":
      return { bin: "yarn", args: ["dlx"] };
    default:
      return { bin: "npx", args: [] };
  }
}

export type EcosystemDetector = {
  id: string;
  match: (workspace: string) => boolean;
  detectPackageManager?: (workspace: string) => string | null;
  detectLintCommand?: (workspace: string) => WorkspaceCommand | null;
  detectFormatCommand?: (workspace: string) => WorkspaceCommand | null;
  detectVerifyCommand?: (workspace: string) => WorkspaceCommand | null;
  detectLineWidth?: (workspace: string) => number | null;
};

function detectProfile(eco: EcosystemDetector, workspace: string): WorkspaceProfile | null {
  const packageManager = eco.detectPackageManager?.(workspace) ?? undefined;
  const lintCommand = eco.detectLintCommand?.(workspace) ?? undefined;
  const formatCommand = eco.detectFormatCommand?.(workspace) ?? undefined;
  const verifyCommand = eco.detectVerifyCommand?.(workspace) ?? undefined;
  const lineWidth = eco.detectLineWidth?.(workspace) ?? undefined;
  return { ecosystem: eco.id, packageManager, lintCommand, formatCommand, verifyCommand, lineWidth };
}

const typescriptDetector: EcosystemDetector = {
  id: "typescript",
  match: (workspace) => fileExists(workspace, "package.json") || fileExists(workspace, "deno.json"),

  detectPackageManager(workspace) {
    const pkg = readJson(workspace, "package.json");
    if (!pkg) return null;
    const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : null;
    if (declared === "bun" || declared === "pnpm" || declared === "yarn" || declared === "npm") return declared;
    if (fileExists(workspace, "bun.lock") || fileExists(workspace, "bun.lockb")) return "bun";
    if (fileExists(workspace, "pnpm-lock.yaml")) return "pnpm";
    if (fileExists(workspace, "yarn.lock")) return "yarn";
    if (fileExists(workspace, "package-lock.json")) return "npm";
    return "bun";
  },

  detectLintCommand(workspace) {
    const { bin, args: prefix } = packageRunner(typescriptDetector.detectPackageManager?.(workspace) ?? "npm");
    for (const name of ["biome.json", "biome.jsonc"]) {
      if (readJson(workspace, name)) return { bin, args: [...prefix, "biome", "check"] };
    }
    if (fileExists(workspace, "oxlintrc.json")) return { bin, args: [...prefix, "oxlint"] };
    for (const name of [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.ts",
      ".eslintrc",
      ".eslintrc.json",
      ".eslintrc.js",
    ]) {
      if (fileExists(workspace, name)) return { bin, args: [...prefix, "eslint"] };
    }
    for (const name of ["deno.json", "deno.jsonc"]) {
      if (readJson(workspace, name)) return { bin: "deno", args: ["lint"] };
    }
    return null;
  },

  detectFormatCommand(workspace) {
    const { bin, args: prefix } = packageRunner(typescriptDetector.detectPackageManager?.(workspace) ?? "npm");
    for (const name of ["biome.json", "biome.jsonc"]) {
      if (readJson(workspace, name)) return { bin, args: [...prefix, "biome", "check", "--write"] };
    }
    for (const name of [".prettierrc", ".prettierrc.json"]) {
      if (readJson(workspace, name)) return { bin, args: [...prefix, "prettier", "--write"] };
    }
    for (const name of ["deno.json", "deno.jsonc"]) {
      if (readJson(workspace, name)) return { bin: "deno", args: ["fmt"] };
    }
    return null;
  },

  detectVerifyCommand(workspace) {
    const pkg = readJson(workspace, "package.json");
    if (pkg) {
      const scripts = (typeof pkg.scripts === "object" && pkg.scripts !== null ? pkg.scripts : {}) as Record<
        string,
        unknown
      >;
      const pm = typescriptDetector.detectPackageManager?.(workspace) ?? "bun";
      for (const name of ["verify", "test", "check"]) {
        if (typeof scripts[name] === "string") return { bin: pm, args: ["run", name] };
      }
    }
    for (const name of ["deno.json", "deno.jsonc"]) {
      if (readJson(workspace, name)) return { bin: "deno", args: ["test"] };
    }
    return null;
  },

  detectLineWidth(workspace) {
    for (const name of ["biome.json", "biome.jsonc"]) {
      const raw = readJson(workspace, name);
      if (!raw) continue;
      const width = (raw as { formatter?: { lineWidth?: unknown } }).formatter?.lineWidth;
      if (typeof width === "number" && width > 0) return width;
    }
    for (const name of ["deno.json", "deno.jsonc"]) {
      const raw = readJson(workspace, name);
      if (!raw) continue;
      const width = (raw as { fmt?: { lineWidth?: unknown } }).fmt?.lineWidth;
      if (typeof width === "number" && width > 0) return width;
    }
    const editorconfigWidth = detectLineWidthFromEditorconfig(workspace);
    if (editorconfigWidth) return editorconfigWidth;
    for (const name of [".prettierrc", ".prettierrc.json"]) {
      const raw = readJson(workspace, name);
      if (!raw) continue;
      const width = (raw as { printWidth?: unknown }).printWidth;
      if (typeof width === "number" && width > 0) return width;
    }
    return null;
  },
};

const pythonDetector: EcosystemDetector = {
  id: "python",
  match: (workspace) =>
    fileExists(workspace, "pyproject.toml") || fileExists(workspace, "setup.py") || fileExists(workspace, "ruff.toml"),

  detectLintCommand(workspace) {
    if (fileExists(workspace, "ruff.toml")) return { bin: "ruff", args: ["check"] };
    const pyproject = readText(workspace, "pyproject.toml");
    if (pyproject?.includes("[tool.ruff]")) return { bin: "ruff", args: ["check"] };
    if (pyproject?.includes("[tool.flake8]") || fileExists(workspace, ".flake8")) return { bin: "flake8", args: [] };
    if (pyproject?.includes("[tool.pylint]") || fileExists(workspace, ".pylintrc"))
      return { bin: "pylint", args: ["--recursive=y", "."] };
    if (pyproject?.includes("[tool.mypy]") || fileExists(workspace, "mypy.ini")) return { bin: "mypy", args: ["."] };
    return null;
  },

  detectFormatCommand(workspace) {
    if (fileExists(workspace, "ruff.toml")) return { bin: "ruff", args: ["format"] };
    const pyproject = readText(workspace, "pyproject.toml");
    if (pyproject?.includes("[tool.ruff]")) return { bin: "ruff", args: ["format"] };
    if (pyproject?.includes("[tool.black]") || fileExists(workspace, ".black")) return { bin: "black", args: ["."] };
    return null;
  },

  detectVerifyCommand(workspace) {
    if (
      fileExists(workspace, "pyproject.toml") ||
      fileExists(workspace, "setup.py") ||
      fileExists(workspace, "setup.cfg")
    )
      return { bin: "pytest", args: [] };
    return null;
  },

  detectLineWidth(workspace) {
    const editorconfigWidth = detectLineWidthFromEditorconfig(workspace);
    if (editorconfigWidth) return editorconfigWidth;
    return null;
  },
};

const goDetector: EcosystemDetector = {
  id: "go",
  match: (workspace) => fileExists(workspace, "go.mod"),
  detectLintCommand(workspace) {
    if (fileExists(workspace, ".golangci.yml") || fileExists(workspace, ".golangci.yaml"))
      return { bin: "golangci-lint", args: ["run"] };
    return { bin: "go", args: ["vet", "./..."] };
  },
  detectFormatCommand: () => ({ bin: "gofmt", args: ["-w"] }),
  detectVerifyCommand: () => ({ bin: "go", args: ["test", "./..."] }),

  detectLineWidth(workspace) {
    const editorconfigWidth = detectLineWidthFromEditorconfig(workspace);
    if (editorconfigWidth) return editorconfigWidth;
    return null;
  },
};

const rustDetector: EcosystemDetector = {
  id: "rust",
  match: (workspace) => fileExists(workspace, "Cargo.toml"),
  detectLintCommand: () => ({ bin: "cargo", args: ["clippy", "--all-targets", "--", "-D", "warnings"] }),
  detectFormatCommand: () => ({ bin: "cargo", args: ["fmt"] }),
  detectVerifyCommand: () => ({ bin: "cargo", args: ["test"] }),

  detectLineWidth(workspace) {
    const editorconfigWidth = detectLineWidthFromEditorconfig(workspace);
    if (editorconfigWidth) return editorconfigWidth;
    return null;
  },
};

export const ECOSYSTEM_DETECTORS: readonly EcosystemDetector[] = [
  typescriptDetector,
  pythonDetector,
  goDetector,
  rustDetector,
];

export function detectWorkspaceProfile(workspace: string): WorkspaceProfile | null {
  for (const eco of ECOSYSTEM_DETECTORS) {
    if (!eco.match(workspace)) continue;
    return detectProfile(eco, workspace);
  }
  return null;
}
