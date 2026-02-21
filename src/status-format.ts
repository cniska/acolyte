export function formatStatusOutput(status: string): string {
  const simplifyModelId = (value: string): string => {
    const knownPrefixes = ["openai/", "openai-compatible/", "anthropic/", "gemini/", "google/"];
    for (const prefix of knownPrefixes) {
      if (value.startsWith(prefix)) {
        return value.slice(prefix.length);
      }
    }
    return value;
  };

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
    if (idx <= 0) {
      continue;
    }
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    fields.set(key, value);
  }

  const output: string[] = [];
  const pushStacked = (
    label: string,
    entries: Array<[string, string | undefined]>,
    plainFirst = false,
    forceHeaderRow = false,
  ): void => {
    const filtered = entries.filter((entry): entry is [string, string] => entry[1] !== undefined);
    if (filtered.length === 0) {
      return;
    }
    const parts = filtered.map(([key, value], index) => {
      if (plainFirst && index === 0 && key === "status") {
        return value;
      }
      return `${key}: ${value}`;
    });
    if (forceHeaderRow) {
      output.push(`${label}:${["", ...parts].join("\n")}`);
      return;
    }
    output.push(`${label}: ${parts.join("\n")}`);
  };

  const take = (key: string): string | undefined => {
    const value = fields.get(key);
    if (value === undefined) {
      return undefined;
    }
    fields.delete(key);
    return value;
  };

  const provider = take("provider") ?? take("mode");
  if (provider) {
    output.push(`provider: ${provider}`);
    fields.delete("mode");
  }
  const modelMain = take("model_main");
  const modelPlanner = take("model_planner");
  const modelCoder = take("model_coder");
  const modelReviewer = take("model_reviewer");
  const model = take("model");
  const displayModel = model ? simplifyModelId(model) : undefined;
  const displayModelMain = modelMain ? simplifyModelId(modelMain) : undefined;
  const displayModelPlanner = modelPlanner ? simplifyModelId(modelPlanner) : undefined;
  const displayModelCoder = modelCoder ? simplifyModelId(modelCoder) : undefined;
  const displayModelReviewer = modelReviewer ? simplifyModelId(modelReviewer) : undefined;
  if (displayModel && displayModel !== displayModelMain) {
    output.push(`model: ${displayModel}`);
  }
  pushStacked(
    "models",
    [
      ["main", displayModelMain],
      ["planner", displayModelPlanner],
      ["coder", displayModelCoder],
      ["reviewer", displayModelReviewer],
    ],
    false,
    true,
  );
  const providerMain = take("provider_main");
  const providerPlanner = take("provider_planner");
  const providerCoder = take("provider_coder");
  const providerReviewer = take("provider_reviewer");
  pushStacked(
    "providers",
    [
      ["main", providerMain],
      ["planner", providerPlanner],
      ["coder", providerCoder],
      ["reviewer", providerReviewer],
    ],
    false,
    true,
  );
  const providerReadyMain = take("provider_ready_main");
  const providerReadyPlanner = take("provider_ready_planner");
  const providerReadyCoder = take("provider_ready_coder");
  const providerReadyReviewer = take("provider_ready_reviewer");
  pushStacked(
    "provider_ready",
    [
      ["main", providerReadyMain],
      ["planner", providerReadyPlanner],
      ["coder", providerReadyCoder],
      ["reviewer", providerReadyReviewer],
    ],
    false,
    true,
  );
  const service = take("service");
  if (service) {
    output.push(`service: ${service}`);
  }
  const url = take("url");
  if (url) {
    output.push(`url: ${url}`);
  }
  const apiBaseUrl = take("api_base_url");
  if (apiBaseUrl) {
    output.push(`api_base_url: ${apiBaseUrl}`);
  }

  const memoryStorage = take("memory_storage");
  if (memoryStorage) {
    output.push(`memory: ${memoryStorage}`);
  }
  const permissionMode = take("permission_mode");
  if (permissionMode) {
    output.push(`permissions: ${permissionMode}`);
  }

  const omEnabled = take("om");
  const omScope = take("om_scope");
  const omModel = take("om_model");
  pushStacked(
    "om",
    [
      ["status", omEnabled],
      ["scope", omScope],
      ["model", omModel],
    ],
    true,
  );

  const omObsTokens = take("om_obs_tokens");
  const omRefTokens = take("om_ref_tokens");
  pushStacked(
    "om_tokens",
    [
      ["obs", omObsTokens],
      ["ref", omRefTokens],
    ],
    false,
    true,
  );

  const omExists = take("om_exists");
  const omGen = take("om_gen");
  const omLastObserved = take("om_last_observed");
  const omLastReflection = take("om_last_reflection");
  pushStacked(
    "om_state",
    [
      ["exists", omExists],
      ["gen", omGen],
      ["last_observed", omLastObserved],
      ["last_reflection", omLastReflection],
    ],
    false,
    true,
  );

  for (const [key, value] of fields.entries()) {
    output.push(`${key}: ${value}`);
  }

  if (output.length === 0) {
    return status;
  }

  const rows = output.map((line) => {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      return { key: line, value: "" };
    }
    const rawValue = line.slice(idx + 1);
    return {
      key: line.slice(0, idx + 1),
      value: rawValue.startsWith("\n") ? rawValue : rawValue.trim(),
    };
  });
  const maxKey = rows.reduce((max, row) => Math.max(max, row.key.length), 0);

  return rows
    .flatMap((row) => {
      const key = row.key.padEnd(maxKey, " ");
      const valueLines = row.value.length > 0 ? row.value.split("\n") : [""];
      const first = `${key} ${valueLines[0] ?? ""}`.trimEnd();
      if (valueLines.length === 1) {
        return [first];
      }
      const continuationIndent = " ".repeat(maxKey + 1);
      const rest = valueLines.slice(1).map((line) => `${continuationIndent}${line}`.trimEnd());
      return [first, ...rest];
    })
    .join("\n");
}
