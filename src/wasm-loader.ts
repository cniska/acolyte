import { readFileSync } from "node:fs";

export function instantiateWasmFile(
  wasmFilePath: string,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  const bytes = readFileSync(wasmFilePath);
  return WebAssembly.instantiate(bytes, imports);
}
