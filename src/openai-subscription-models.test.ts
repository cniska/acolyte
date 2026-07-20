import { beforeEach, describe, expect, test } from "bun:test";
import { isOpenAiSubscriptionModel, resetSubscriptionModelsCache } from "./openai-subscription-models";

describe("isOpenAiSubscriptionModel", () => {
  beforeEach(resetSubscriptionModelsCache);

  test("treats no model as a subscription model until discovery has run", () => {
    // Membership is the single source of truth; before discovery populates the served set nothing
    // routes to the subscription. Populated-set behavior is covered in the integration test.
    expect(isOpenAiSubscriptionModel("gpt-5.5")).toBe(false);
    expect(isOpenAiSubscriptionModel("gpt-5-codex")).toBe(false);
    expect(isOpenAiSubscriptionModel("gpt-4o")).toBe(false);
  });
});
