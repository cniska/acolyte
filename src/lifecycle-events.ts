export type LifecycleEventName = `lifecycle.${string}`;

export type LifecycleDebugEvent = {
  event: LifecycleEventName;
  sequence: number;
  phaseAttempt: number;
  ts: string;
  fields?: Record<string, unknown>;
};
