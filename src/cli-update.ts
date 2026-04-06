import { checkForUpdate } from "./cli-update-check";
import { installUpdate } from "./cli-update-install";
import { renderUpdateDone, renderUpdateError, renderUpdateHeader, renderUpdateProgress } from "./cli-update-ui";
import { resolveCliVersion } from "./cli-version";
import { stopAllLocalServers } from "./server-daemon";
import { printDim, printOutput } from "./ui";

function reexec(): never {
  Bun.spawnSync([process.execPath, ...process.argv.slice(1)], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(0);
}

export async function updateMode(): Promise<void> {
  const currentVersion = resolveCliVersion();
  printDim(`Current version: ${currentVersion}`);
  printDim("Checking for updates...");

  const update = await checkForUpdate(currentVersion, { force: true });

  if (!update) {
    printOutput("Could not check for updates. Check your network connection.");
    return;
  }

  if (!update.available) {
    printOutput(`Already up to date (${currentVersion}).`);
    return;
  }

  await performUpdate(currentVersion, update.latest, update.downloadUrl);
}

export async function checkAndUpdateOnStartup(): Promise<boolean> {
  if (process.env.ACOLYTE_SKIP_UPDATE === "1") return false;
  if (process.argv.includes("--skip-update")) return false;

  const currentVersion = resolveCliVersion();
  if (currentVersion === "dev") return false;

  const update = await checkForUpdate(currentVersion);
  if (!update?.available) return false;

  await performUpdate(currentVersion, update.latest, update.downloadUrl);
  return true;
}

async function performUpdate(currentVersion: string, latest: string, downloadUrl: string): Promise<void> {
  renderUpdateHeader(currentVersion, latest);

  const result = await installUpdate(downloadUrl, (received, total) => {
    renderUpdateProgress(received, total);
  });

  if (!result.success) {
    renderUpdateError(result.error ?? "unknown error");
    return;
  }

  renderUpdateDone(latest);

  await stopAllLocalServers();
  reexec();
}
