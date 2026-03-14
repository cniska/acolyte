import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveFreePort } from "./port-utils";

type TomlValue = string | number | boolean;

export type TempConfigHome = {
  homeDir: string;
  port: number;
  env: Record<string, string>;
  configPath: string;
};

function toTomlRecord(input: Record<string, TomlValue>): string {
  return Object.entries(input)
    .map(([key, value]) => {
      if (typeof value === "number" || typeof value === "boolean") return `${key} = ${value}`;
      return `${key} = ${JSON.stringify(value)}`;
    })
    .join("\n");
}

export async function createTempConfigHome(
  prefix: string,
  config: Record<string, TomlValue>,
  extraEnv: Record<string, string> = {},
): Promise<TempConfigHome> {
  const homeDir = await mkdtemp(join(tmpdir(), prefix));
  const configDir = join(homeDir, ".acolyte");
  const port = reserveFreePort();
  const resolvedConfig = { ...config, port };
  const configPath = join(configDir, "config.toml");

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, `${toTomlRecord(resolvedConfig)}\n`, "utf8");

  return {
    homeDir,
    port,
    configPath,
    env: {
      ...(process.env as Record<string, string>),
      HOME: homeDir,
      NO_COLOR: "1",
      ...extraEnv,
    },
  };
}
