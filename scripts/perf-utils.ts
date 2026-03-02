import { createMarkerScenarioHandler, type FakeProviderRequestContext } from "./fake-provider-server";
import { PERF_SCENARIOS } from "./perf-scenarios";

export function createPerfProviderHandler(): (ctx: FakeProviderRequestContext) => Record<string, unknown> {
  return createMarkerScenarioHandler(PERF_SCENARIOS);
}
