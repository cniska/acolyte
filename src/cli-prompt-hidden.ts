export async function promptHidden(question: string): Promise<string | undefined> {
  if (!process.stdin.isTTY) return prompt(question)?.trim();

  return new Promise((resolve) => {
    let value = "";

    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\u0003") {
          process.stdout.write("\n");
          cleanup();
          process.exitCode = 1;
          resolve(undefined);
          return;
        }
        if (char === "\r" || char === "\n") {
          process.stdout.write("\n");
          if (value.trim().length === 0) {
            value = "";
            process.stdout.write(question);
            return;
          }
          cleanup();
          resolve(value.trim());
          return;
        }
        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
