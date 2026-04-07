import { init } from "tiktoken/init";
// Bun import attribute ensures this asset is bundled for `bun build --compile`
// and yields an on-disk path at runtime.
import tiktokenWasmFilePath from "tiktoken/tiktoken_bg.wasm" with { type: "file" };
import { instantiateWasmFile } from "./wasm-loader";

let initialized = false;
let initPromise: Promise<void> | null = null;

export function ensureTiktokenInitialized(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  // TS doesn't model Bun's `with { type: "file" }` typing yet; runtime value is a file path string.
  const wasmPath = tiktokenWasmFilePath as unknown as string;
  initPromise = init((imports) => instantiateWasmFile(wasmPath, imports)).then(() => {
    initialized = true;
  });
  return initPromise;
}
