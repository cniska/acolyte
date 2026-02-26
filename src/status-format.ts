function simplifyModelId(value: string): string {
  const knownPrefixes = ["openai/", "openai-compatible/", "anthropic/", "gemini/", "google/"];
  for (const prefix of knownPrefixes) {
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return value;
}

export function formatStatusOutput(status: string): string {
  const pairs = status
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.includes("="));
  if (pairs.length === 0) {
    return status;
  }
  const fields = new Map<string, string>();
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      fields.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  const take = (key: string): string | undefined => {
    const value = fields.get(key);
    fields.delete(key);
    return value;
  };

  const rows: Array<[string, string]> = [];
  const push = (key: string, value: string | undefined): void => {
    if (value) {
      rows.push([key, value]);
    }
  };

  // Provider
  push("provider", take("provider") ?? take("mode"));
  fields.delete("mode");
  take("provider_ready");
  take("provider_api_url");
  for (const key of [...fields.keys()]) {
    if (key.startsWith("provider_api_url_")) {
      fields.delete(key);
    }
  }

  // Model
  const model = take("model");
  push("model", model ? simplifyModelId(model) : undefined);
  const exploreModel = take("explore_model");
  if (exploreModel) {
    push("explore", simplifyModelId(exploreModel));
  }

  // Permissions
  push("permissions", take("permission_mode"));

  // Service
  const service = take("service");
  const url = take("url");
  push("service", service && url ? `${service} (${url})` : (service ?? url));

  // Memory
  const memoryStorage = take("memory_storage");
  const memoryContext = take("memory_context");
  push("memory", memoryStorage && memoryContext ? `${memoryStorage} (${memoryContext} entries)` : memoryStorage);

  // OM — compact single line
  const omEnabled = take("om");
  const omScope = take("om_scope");
  take("om_model");
  take("om_obs_tokens");
  take("om_ref_tokens");
  take("om_exists");
  take("om_gen");
  take("om_last_observed");
  take("om_last_reflection");
  push("observational memory", omEnabled && omScope ? `${omEnabled} (${omScope})` : omEnabled);

  // Remaining
  for (const [key, value] of fields.entries()) {
    push(key, value);
  }

  if (rows.length === 0) {
    return status;
  }

  const colWidth = Math.max(20, ...rows.map(([key]) => `${key}:`.length + 1));
  return rows.map(([key, value]) => `${`${key}:`.padEnd(colWidth)}${value}`).join("\n");
}
