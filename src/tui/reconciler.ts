import type { ReactNode } from "react";
import ReactReconciler from "react-reconciler";
import type { TuiElement } from "./dom";
import { hostConfig } from "./host-config";

// biome-ignore lint/suspicious/noExplicitAny: react-reconciler types don't match runtime
const baseReconciler = ReactReconciler(hostConfig as any);

type OpaqueRoot = ReturnType<typeof baseReconciler.createContainer>;

interface TuiReconciler {
  createContainer: typeof baseReconciler.createContainer;
  updateContainer(
    element: ReactNode,
    container: OpaqueRoot,
    parentComponent: null,
    callback: (() => void) | null,
  ): void;
  updateContainerSync(
    element: ReactNode,
    container: OpaqueRoot,
    parentComponent: null,
    callback: (() => void) | null,
  ): void;
  flushSyncWork(): void;
  flushPassiveEffects(): boolean;
  getPublicRootInstance(container: OpaqueRoot): TuiElement | null;
}

export const reconciler: TuiReconciler = baseReconciler as TuiReconciler;
