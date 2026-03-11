import { describe, expect, test } from "bun:test";
import { connectionHelpMessage } from "./error-messages";
import { t } from "./i18n";

describe("connectionHelpMessage", () => {
  test("returns HTTPS-on-loopback hint for https://localhost", () => {
    const url = "https://localhost:4321";
    expect(connectionHelpMessage(url)).toBe(t("error.connection.loopback_https", { url }));
  });

  test("returns loopback default hint for http://127.0.0.1", () => {
    const url = "http://127.0.0.1:4321";
    expect(connectionHelpMessage(url)).toBe(t("error.connection.loopback_default", { url }));
  });

  test("returns loopback default hint for http://localhost", () => {
    const url = "http://localhost:4321";
    expect(connectionHelpMessage(url)).toBe(t("error.connection.loopback_default", { url }));
  });

  test("returns generic hint for remote URL", () => {
    const url = "http://remote.example.com:4321";
    expect(connectionHelpMessage(url)).toBe(t("error.connection.generic", { url }));
  });

  test("returns generic hint for malformed URL", () => {
    const url = "not-a-url";
    expect(() => connectionHelpMessage(url)).not.toThrow();
    expect(connectionHelpMessage(url)).toBe(t("error.connection.generic", { url }));
  });
});
