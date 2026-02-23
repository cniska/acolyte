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
    const keyed = filtered.map(([key, value], index) => ({
      key,
      value,
      plain: plainFirst && index === 0 && key === "status",
    }));
    const nestedKeyMax = keyed.reduce((max, entry) => {
      if (entry.plain) {
        return max;
      }
      return Math.max(max, `${entry.key}:`.length);
    }, 0);
    const parts = keyed.map((entry) => {
      if (entry.plain) {
        return entry.value;
      }
      const nestedKey = `${entry.key}:`.padEnd(nestedKeyMax, " ");
      return `${nestedKey} ${entry.value}`;
    });
    if (forceHeaderRow) {
      output.push(`${label}:${["", ...parts].join("\n")}`);
      return;
    }
    output.push(`${label}: ${parts.join("\n")}`);
  };
  const isReady = (value: string | undefined): boolean => {
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "ready" || normalized === "ok" || normalized === "healthy";
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
  fields.delete("mode");
  const providerMain = take("provider_lead");
  const providerPlanner = take("provider_planner");
  const providerCoder = take("provider_coder");
  const providerReviewer = take("provider_reviewer");
  const providerApiUrl = take("api_url");
  const primaryProvider = providerMain ?? provider ?? providerPlanner ?? providerCoder ?? providerReviewer;
  pushStacked(
    "provider",
    [
      ["status", primaryProvider],
      ["planner", providerPlanner && providerPlanner !== primaryProvider ? providerPlanner : undefined],
      ["coder", providerCoder && providerCoder !== primaryProvider ? providerCoder : undefined],
      ["reviewer", providerReviewer && providerReviewer !== primaryProvider ? providerReviewer : undefined],
      ["api_url", primaryProvider ? providerApiUrl : undefined],
    ],
    true,
  );
  const modelMain = take("model_lead");
  const modelPlanner = take("model_planner");
  const modelCoder = take("model_coder");
  const modelReviewer = take("model_reviewer");
  const model = take("model");
  const displayModel = model ? simplifyModelId(model) : undefined;
  const displayModelMain = modelMain ? simplifyModelId(modelMain) : undefined;
  const displayModelPlanner = modelPlanner ? simplifyModelId(modelPlanner) : undefined;
  const displayModelCoder = modelCoder ? simplifyModelId(modelCoder) : undefined;
  const displayModelReviewer = modelReviewer ? simplifyModelId(modelReviewer) : undefined;
  const primaryModel =
    displayModelMain ?? displayModel ?? displayModelPlanner ?? displayModelCoder ?? displayModelReviewer;
  pushStacked(
    "model",
    [
      ["status", primaryModel],
      ["planner", displayModelPlanner && displayModelPlanner !== primaryModel ? displayModelPlanner : undefined],
      ["coder", displayModelCoder && displayModelCoder !== primaryModel ? displayModelCoder : undefined],
      ["reviewer", displayModelReviewer && displayModelReviewer !== primaryModel ? displayModelReviewer : undefined],
    ],
    true,
  );
  const providerReadyMain = take("provider_ready_lead");
  const providerReadyPlanner = take("provider_ready_planner");
  const providerReadyCoder = take("provider_ready_coder");
  const providerReadyReviewer = take("provider_ready_reviewer");
  const providerReadyRows: Array<[string, string | undefined]> = [
    ["lead", providerReadyMain],
    ["planner", providerReadyPlanner],
    ["coder", providerReadyCoder],
    ["reviewer", providerReadyReviewer],
  ];
  const hasProviderReadinessIssue = providerReadyRows.some(([, value]) => value !== undefined && !isReady(value));
  if (hasProviderReadinessIssue) {
    pushStacked("provider_ready", providerReadyRows, false, true);
  }
  const service = take("service");
  if (service) {
    output.push(`service: ${service}`);
  }
  const url = take("url");
  if (url) {
    output.push(`api_url: ${url}`);
  }

  const memoryStorage = take("memory_storage");
  const memoryContext = take("memory_context");
  pushStacked(
    "memory",
    [
      ["status", memoryStorage],
      ["entries", memoryContext],
    ],
    true,
  );
  const permissionMode = take("permission_mode");
  if (permissionMode) {
    output.push(`permissions: ${permissionMode}`);
  }

  const omEnabled = take("om");
  const omScope = take("om_scope");
  const omModel = take("om_model");
  const displayOmModel = omModel ? simplifyModelId(omModel) : undefined;
  const omObsTokens = take("om_obs_tokens");
  const omRefTokens = take("om_ref_tokens");
  const omTokens =
    omObsTokens || omRefTokens ? [`obs=${omObsTokens ?? "n/a"}`, `ref=${omRefTokens ?? "n/a"}`].join(" ") : undefined;
  const omExists = take("om_exists");
  const omGen = take("om_gen");
  const omState = omExists || omGen ? [`exists=${omExists ?? "n/a"}`, `gen=${omGen ?? "n/a"}`].join(" ") : undefined;
  const omLastObserved = take("om_last_observed");
  const omLastReflection = take("om_last_reflection");
  pushStacked(
    "om",
    [
      ["status", omEnabled],
      ["scope", omScope],
      ["model", displayOmModel],
      ["tokens", omTokens],
      ["state", omState],
      ["last_observed", omLastObserved],
      ["last_reflection", omLastReflection],
    ],
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
