import { afterEach, describe, expect, test } from "bun:test";
import { setConfigValue } from "./config";
import { setLocale } from "./i18n";

async function rejection(key: string, value: string): Promise<string> {
  try {
    await setConfigValue(key, value);
    throw new Error(`expected ${key}=${value} to be rejected`);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("invalid config value", () => {
  afterEach(() => {
    setLocale("en");
  });

  test("names the key, echoes the value, and directs to the accepted ones", async () => {
    expect(await rejection("locale", "klingon")).toBe("Invalid locale: klingon. Use en, fi, or sv.");
    expect(await rejection("logFormat", "yaml")).toBe("Invalid logFormat: yaml. Use logfmt or json.");
  });

  test("directs to the shape a number must take", async () => {
    expect(await rejection("port", "notanumber")).toBe("Invalid port: notanumber. Use a whole number.");
    expect(await rejection("port", "0")).toBe("Invalid port: 0. Use a number no lower than 1.");
    expect(await rejection("port", "99999")).toBe("Invalid port: 99999. Use a number no higher than 65535.");
  });

  test("carries the schema's own reason", async () => {
    expect(await rejection("embeddingBaseUrl", "http://evil.com")).toBe(
      "Invalid embeddingBaseUrl: http://evil.com. Use HTTPS unless it targets localhost.",
    );
  });

  test("announces invalidity once, whatever the reason", async () => {
    for (const [key, value] of [
      ["locale", "klingon"],
      ["port", "notanumber"],
      ["port", "99999"],
      ["embeddingBaseUrl", "http://evil.com"],
    ]) {
      const message = await rejection(key, value);
      expect(message.match(/Invalid/g)).toHaveLength(1);
      expect(message).toStartWith(`Invalid ${key}: ${value}. Use `);
      expect(message).toEndWith(".");
    }
  });

  test("translates the whole line, reason included", async () => {
    setLocale("fi");
    expect(await rejection("locale", "klingon")).toBe("Virheellinen locale: klingon. Käytä en, fi tai sv.");
    expect(await rejection("port", "notanumber")).toBe("Virheellinen port: notanumber. Käytä kokonaislukua.");
    setLocale("sv");
    expect(await rejection("locale", "klingon")).toBe("Ogiltig locale: klingon. Använd en, fi eller sv.");
  });
});
