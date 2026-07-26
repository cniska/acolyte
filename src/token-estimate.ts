type TokenEncoder = { encode(input: string): { length: number } };

function createApproxEncoder(): TokenEncoder {
  return {
    encode(input) {
      // We use token estimates for budgeting and truncation. Exact accuracy is
      // not required for commands that don't run the lifecycle. The lifecycle
      // switches this to the real tokenizer via ensureRealTokenEncoder().
      return { length: Math.ceil(input.length / 4) };
    },
  };
}

let defaultEncoder: TokenEncoder = createApproxEncoder();
let activeEncoder: TokenEncoder = defaultEncoder;
let tiktokenReady = false;
let tiktokenInitPromise: Promise<void> | null = null;

export async function ensureRealTokenEncoder(): Promise<void> {
  if (tiktokenReady) return;
  if (tiktokenInitPromise) return tiktokenInitPromise;

  const prevDefault = defaultEncoder;
  tiktokenInitPromise = (async () => {
    const { ensureTiktokenInitialized } = await import("./tiktoken-runtime");
    const { encoding_for_model } = await import("tiktoken/init");
    await ensureTiktokenInitialized();
    defaultEncoder = encoding_for_model("gpt-4o");
    if (activeEncoder === prevDefault) activeEncoder = defaultEncoder;
    tiktokenReady = true;
  })();

  return tiktokenInitPromise;
}

/** Replace the tokenizer (test-only). */
export function setTokenEncoder(encoder: TokenEncoder | null): void {
  activeEncoder = encoder ?? defaultEncoder;
}

export function estimateTokens(input: string): number {
  if (input.length === 0) return 0;
  return activeEncoder.encode(input).length;
}
