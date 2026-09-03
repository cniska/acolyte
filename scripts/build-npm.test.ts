import { describe, expect, test } from "bun:test";
import { createCliManifest, createPlatformManifest, PLATFORMS } from "./build-npm";

const [darwinArm64] = PLATFORMS;

describe("npm platform manifest", () => {
  test("restricts the package to the platform it holds a binary for", () => {
    const manifest = createPlatformManifest(darwinArm64, "1.2.3");

    expect(manifest.name).toBe("@acolyte/darwin-arm64");
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.os).toEqual(["darwin"]);
    expect(manifest.cpu).toEqual(["arm64"]);
    expect(manifest.files).toEqual(["acolyte"]);
  });
});

describe("npm cli manifest", () => {
  test("pins every platform package to the exact release version", () => {
    const manifest = createCliManifest("1.2.3", PLATFORMS);

    expect(manifest.optionalDependencies).toEqual({
      "@acolyte/darwin-arm64": "1.2.3",
      "@acolyte/linux-x64": "1.2.3",
    });
  });

  test("publishes the command as the shim beside the launcher", () => {
    const manifest = createCliManifest("1.2.3", PLATFORMS);

    expect(manifest.bin).toEqual({ acolyte: "bin/acolyte.cjs" });
    expect(manifest.files).toEqual(["bin/acolyte.cjs", "launcher.sh"]);
  });
});
