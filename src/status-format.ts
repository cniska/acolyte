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
    if (idx <= 0) {
      continue;
    }
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    fields.set(key, value);
  }

  const output: string[] = [];
  const pushStacked = (label: string, entries: Array<[string, string | undefined]>, plainFirst = false): void => {
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
  const model = take("model");
  if (model) {
    output.push(`model: ${model}`);
  }
  const modelMain = take("model_main");
  const modelPlanner = take("model_planner");
  const modelCoder = take("model_coder");
  const modelReviewer = take("model_reviewer");
  pushStacked("models", [
    ["main", modelMain],
    ["planner", modelPlanner],
    ["coder", modelCoder],
    ["reviewer", modelReviewer],
  ]);
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
  pushStacked("om_tokens", [
    ["obs", omObsTokens],
    ["ref", omRefTokens],
  ]);

  const omExists = take("om_exists");
  const omGen = take("om_gen");
  const omLastObserved = take("om_last_observed");
  const omLastReflection = take("om_last_reflection");
  pushStacked("om_state", [
    ["exists", omExists],
    ["gen", omGen],
    ["last_observed", omLastObserved],
    ["last_reflection", omLastReflection],
  ]);

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
    return {
      key: line.slice(0, idx + 1),
      value: line.slice(idx + 1).trim(),
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
