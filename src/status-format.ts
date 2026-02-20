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
  }
  const model = take("model");
  if (model) {
    output.push(`model: ${model}`);
  }
  const modelMain = take("model_main");
  const modelPlanner = take("model_planner");
  const modelCoder = take("model_coder");
  const modelReviewer = take("model_reviewer");
  if (modelMain || modelPlanner || modelCoder || modelReviewer) {
    const parts: string[] = [];
    if (modelMain) {
      parts.push(`main=${modelMain}`);
    }
    if (modelPlanner) {
      parts.push(`planner=${modelPlanner}`);
    }
    if (modelCoder) {
      parts.push(`coder=${modelCoder}`);
    }
    if (modelReviewer) {
      parts.push(`reviewer=${modelReviewer}`);
    }
    output.push(`models: ${parts.join(" ")}`);
  }
  const service = take("service");
  if (service) {
    output.push(`service: ${service}`);
  }
  const url = take("url");
  if (url) {
    output.push(`url: ${url}`);
  }

  const memoryStorage = take("memory_storage");
  if (memoryStorage) {
    output.push(`memory: ${memoryStorage}`);
  }

  const omEnabled = take("om");
  const omScope = take("om_scope");
  const omModel = take("om_model");
  if (omEnabled || omScope || omModel) {
    const parts: string[] = [];
    if (omEnabled) {
      parts.push(omEnabled);
    }
    if (omScope) {
      parts.push(`scope=${omScope}`);
    }
    if (omModel) {
      parts.push(`model=${omModel}`);
    }
    output.push(`om: ${parts.join(" ")}`);
  }

  const omObsTokens = take("om_obs_tokens");
  const omRefTokens = take("om_ref_tokens");
  if (omObsTokens || omRefTokens) {
    output.push(
      `om_tokens: ${[omObsTokens ? `obs=${omObsTokens}` : "", omRefTokens ? `ref=${omRefTokens}` : ""]
        .filter((part) => part.length > 0)
        .join(" ")}`,
    );
  }

  const omExists = take("om_exists");
  const omGen = take("om_gen");
  const omLastObserved = take("om_last_observed");
  const omLastReflection = take("om_last_reflection");
  if (omExists || omGen || omLastObserved || omLastReflection) {
    const parts: string[] = [];
    if (omExists) {
      parts.push(`exists=${omExists}`);
    }
    if (omGen) {
      parts.push(`gen=${omGen}`);
    }
    if (omLastObserved) {
      parts.push(`last_observed=${omLastObserved}`);
    }
    if (omLastReflection) {
      parts.push(`last_reflection=${omLastReflection}`);
    }
    output.push(`om_state: ${parts.join(" ")}`);
  }

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
    .map((row) => {
      const key = row.key.padEnd(maxKey, " ");
      return `${key} ${row.value}`.trimEnd();
    })
    .join("\n");
}
