import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./json";
import type { WorkspaceCommand, WorkspaceProfile } from "./workspace-profile";

export function fileExists(workspace: string, name: string): boolean {
  return existsSync(join(workspace, name));
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

export type DetectContext = { workspace: string; packageManager?: string };

export type EcosystemDetector = {
  id: string;
  match: (workspace: string) => boolean;
  detectPackageManager?: (workspace: string) => string | null;
  detectInstallCommand?: (ctx: DetectContext) => WorkspaceCommand | null;
  detectLintCommand?: (ctx: DetectContext) => WorkspaceCommand | null;
  detectFormatCommand?: (ctx: DetectContext) => WorkspaceCommand | null;
  detectTestCommand?: (ctx: DetectContext) => WorkspaceCommand | null;
  depsDir?: string;
};

function detectProfile(eco: EcosystemDetector, workspace: string): WorkspaceProfile | null {
  const packageManager = eco.detectPackageManager?.(workspace) ?? undefined;
  const ctx: DetectContext = { workspace, packageManager };
  const installCommand = eco.detectInstallCommand?.(ctx) ?? undefined;
  const lintCommand = eco.detectLintCommand?.(ctx) ?? undefined;
  const formatCommand = eco.detectFormatCommand?.(ctx) ?? undefined;
  const testCommand = eco.detectTestCommand?.(ctx) ?? undefined;
  return {
    ecosystem: eco.id,
    packageManager,
    installCommand,
    depsDir: eco.depsDir,
    lintCommand,
    formatCommand,
    testCommand,
  };
}

const typescriptDetector: EcosystemDetector = {
  id: "typescript",
  match: (workspace) => fileExists(workspace, "package.json") || fileExists(workspace, "deno.json"),
  depsDir: "node_modules",

  detectPackageManager(workspace) {
    const pkg = readJson(workspace, "package.json");
    if (!pkg) return null;
    const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : null;
    if (declared === "bun" || declared === "pnpm" || declared === "yarn" || declared === "npm") return declared;
    if (fileExists(workspace, "bun.lock") || fileExists(workspace, "bun.lockb")) return "bun";
    if (fileExists(workspace, "pnpm-lock.yaml")) return "pnpm";
    if (fileExists(workspace, "yarn.lock")) return "yarn";
    if (fileExists(workspace, "package-lock.json")) return "npm";
    return "npm";
  },

  detectInstallCommand(ctx) {
    const pm = ctx.packageManager ?? "npm";
    return { bin: pm, args: ["install"] };
  },

  detectLintCommand(ctx) {
    const { bin, args: prefix } = packageRunner(ctx.packageManager ?? "npm");
    for (const name of ["biome.json", "biome.jsonc"]) {
      if (readJson(ctx.workspace, name)) return { bin, args: [...prefix, "biome", "check", "$FILES"] };
    }
    if (fileExists(ctx.workspace, "oxlintrc.json")) return { bin, args: [...prefix, "oxlint", "$FILES"] };
    for (const name of [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.ts",
      ".eslintrc",
      ".eslintrc.json",
      ".eslintrc.js",
    ]) {
      if (fileExists(ctx.workspace, name)) return { bin, args: [...prefix, "eslint", "$FILES"] };
    }
    for (const name of ["deno.json", "deno.jsonc"]) {
      if (readJson(ctx.workspace, name)) return { bin: "deno", args: ["lint", "$FILES"] };
    }
    return null;
  },

  detectFormatCommand(ctx) {
    const { bin, args: prefix } = packageRunner(ctx.packageManager ?? "npm");
    for (const name of ["biome.json", "biome.jsonc"]) {
      if (readJson(ctx.workspace, name)) return { bin, args: [...prefix, "biome", "check", "--write", "$FILES"] };
    }
    for (const name of [".prettierrc", ".prettierrc.json"]) {
      if (readJson(ctx.workspace, name)) return { bin, args: [...prefix, "prettier", "--write", "$FILES"] };
    }
    for (const name of ["deno.json", "deno.jsonc"]) {
      if (readJson(ctx.workspace, name)) return { bin: "deno", args: ["fmt", "$FILES"] };
    }
    return null;
  },

  detectTestCommand(ctx) {
    const { bin, args: prefix } = packageRunner(ctx.packageManager ?? "npm");
    const pkg = readJson(ctx.workspace, "package.json");
    if (pkg) {
      const scripts = (typeof pkg.scripts === "object" && pkg.scripts !== null ? pkg.scripts : {}) as Record<
        string,
        unknown
      >;
      if (typeof scripts.test === "string") {
        const script = scripts.test;
        if (script.includes("vitest")) return { bin, args: [...prefix, "vitest", "$FILES"] };
        if (script.includes("jest")) return { bin, args: [...prefix, "jest", "$FILES"] };
      }
    }
    for (const name of ["vitest.config.ts", "vitest.config.js", "vitest.config.mts"]) {
      if (fileExists(ctx.workspace, name)) return { bin, args: [...prefix, "vitest", "$FILES"] };
    }
    for (const name of ["jest.config.js", "jest.config.ts", "jest.config.mjs"]) {
      if (fileExists(ctx.workspace, name)) return { bin, args: [...prefix, "jest", "$FILES"] };
    }
    if (ctx.packageManager === "bun") return { bin: "bun", args: ["test", "$FILES"] };
    for (const name of ["deno.json", "deno.jsonc"]) {
      if (readJson(ctx.workspace, name)) return { bin: "deno", args: ["test", "$FILES"] };
    }
    return null;
  },
};

const pythonDetector: EcosystemDetector = {
  id: "python",
  match: (workspace) =>
    fileExists(workspace, "pyproject.toml") || fileExists(workspace, "setup.py") || fileExists(workspace, "ruff.toml"),
  depsDir: ".venv",

  detectPackageManager(workspace) {
    if (fileExists(workspace, "uv.lock")) return "uv";
    if (fileExists(workspace, "poetry.lock")) return "poetry";
    if (fileExists(workspace, "Pipfile.lock")) return "pipenv";
    return "pip";
  },

  detectInstallCommand(ctx) {
    switch (ctx.packageManager) {
      case "uv":
        return { bin: "uv", args: ["sync"] };
      case "poetry":
        return { bin: "poetry", args: ["install"] };
      case "pipenv":
        return { bin: "pipenv", args: ["install"] };
      default:
        return { bin: "pip", args: ["install", "-e", "."] };
    }
  },

  detectLintCommand(ctx) {
    if (fileExists(ctx.workspace, "ruff.toml")) return { bin: "ruff", args: ["check", "$FILES"] };
    const pyproject = readText(ctx.workspace, "pyproject.toml");
    if (pyproject?.includes("[tool.ruff]")) return { bin: "ruff", args: ["check", "$FILES"] };
    if (pyproject?.includes("[tool.flake8]") || fileExists(ctx.workspace, ".flake8"))
      return { bin: "flake8", args: ["$FILES"] };
    if (pyproject?.includes("[tool.pylint]") || fileExists(ctx.workspace, ".pylintrc"))
      return { bin: "pylint", args: ["$FILES"] };
    if (pyproject?.includes("[tool.mypy]") || fileExists(ctx.workspace, "mypy.ini"))
      return { bin: "mypy", args: ["$FILES"] };
    return null;
  },

  detectFormatCommand(ctx) {
    if (fileExists(ctx.workspace, "ruff.toml")) return { bin: "ruff", args: ["format", "$FILES"] };
    const pyproject = readText(ctx.workspace, "pyproject.toml");
    if (pyproject?.includes("[tool.ruff]")) return { bin: "ruff", args: ["format", "$FILES"] };
    if (pyproject?.includes("[tool.black]") || fileExists(ctx.workspace, ".black"))
      return { bin: "black", args: ["$FILES"] };
    return null;
  },

  detectTestCommand(ctx) {
    const pyproject = readText(ctx.workspace, "pyproject.toml");
    if (pyproject?.includes("[tool.pytest]") || fileExists(ctx.workspace, "pytest.ini"))
      return { bin: "pytest", args: ["$FILES"] };
    if (pyproject?.includes("[tool.nose2]")) return { bin: "nose2", args: ["$FILES"] };
    if (
      fileExists(ctx.workspace, "pyproject.toml") ||
      fileExists(ctx.workspace, "setup.py") ||
      fileExists(ctx.workspace, "setup.cfg")
    )
      return { bin: "pytest", args: ["$FILES"] };
    return null;
  },
};

const goDetector: EcosystemDetector = {
  id: "go",
  match: (workspace) => fileExists(workspace, "go.mod"),
  detectInstallCommand: () => ({ bin: "go", args: ["mod", "download"] }),
  detectLintCommand(ctx) {
    if (fileExists(ctx.workspace, ".golangci.yml") || fileExists(ctx.workspace, ".golangci.yaml"))
      return { bin: "golangci-lint", args: ["run", "$FILES"] };
    return { bin: "go", args: ["vet", "$FILES"] };
  },
  detectFormatCommand: () => ({ bin: "gofmt", args: ["-w", "$FILES"] }),
  detectTestCommand: () => ({ bin: "go", args: ["test", "$FILES"] }),
};

const rustDetector: EcosystemDetector = {
  id: "rust",
  match: (workspace) => fileExists(workspace, "Cargo.toml"),
  detectInstallCommand: () => ({ bin: "cargo", args: ["fetch"] }),
  detectLintCommand: () => ({ bin: "cargo", args: ["clippy", "--all-targets", "--", "-D", "warnings", "$FILES"] }),
  detectFormatCommand: () => ({ bin: "cargo", args: ["fmt", "--", "$FILES"] }),
  detectTestCommand: () => ({ bin: "cargo", args: ["test", "--", "$FILES"] }),
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
