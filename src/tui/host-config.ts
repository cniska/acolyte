import {
  type TuiElement,
  type TuiNode,
  type TuiNodeType,
  type TuiProps,
  appendChild,
  createElement,
  createTextNode,
  insertBefore,
  removeChild,
} from "./dom";

type Props = TuiProps & { children?: unknown };
type TextInstance = { kind: "text"; value: string; parent: TuiElement | null };

function propsFromRaw(raw: Props): TuiProps {
  const { children: _, ...rest } = raw;
  return rest;
}

let onCommit: (() => void) | null = null;

export function setOnCommit(fn: (() => void) | null): void {
  onCommit = fn;
}

export const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,

  createInstance(type: TuiNodeType, props: Props) {
    return createElement(type, propsFromRaw(props));
  },

  createTextInstance(text: string): TextInstance {
    return createTextNode(text);
  },

  appendInitialChild(parent: TuiElement, child: TuiElement | TextInstance) {
    appendChild(parent, child as TuiNode);
  },

  appendChild(parent: TuiElement, child: TuiElement | TextInstance) {
    appendChild(parent, child as TuiNode);
  },

  appendChildToContainer(container: TuiElement, child: TuiElement | TextInstance) {
    appendChild(container, child as TuiNode);
  },

  removeChild(parent: TuiElement, child: TuiElement | TextInstance) {
    removeChild(parent, child as TuiNode);
  },

  removeChildFromContainer(container: TuiElement, child: TuiElement | TextInstance) {
    removeChild(container, child as TuiNode);
  },

  insertBefore(parent: TuiElement, child: TuiElement | TextInstance, before: TuiElement | TextInstance) {
    insertBefore(parent, child as TuiNode, before as TuiNode);
  },

  insertInContainerBefore(container: TuiElement, child: TuiElement | TextInstance, before: TuiElement | TextInstance) {
    insertBefore(container, child as TuiNode, before as TuiNode);
  },

  commitUpdate(instance: TuiElement, _type: TuiNodeType, _oldProps: Props, newProps: Props) {
    instance.props = propsFromRaw(newProps);
  },

  commitTextUpdate(textInstance: TextInstance, _oldText: string, newText: string) {
    textInstance.value = newText;
  },

  finalizeInitialChildren() {
    return false;
  },

  prepareForCommit() {
    return null;
  },

  resetAfterCommit() {
    onCommit?.();
  },

  getPublicInstance(instance: TuiElement) {
    return instance;
  },

  getRootHostContext() {
    return {};
  },

  getChildHostContext(parentHostContext: Record<string, never>) {
    return parentHostContext;
  },

  shouldSetTextContent() {
    return false;
  },

  clearContainer(container: TuiElement) {
    container.children = [];
  },

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1 as const,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,

  NotPendingTransition: null as never,
  HostTransitionContext: {
    $$typeof: Symbol.for("react.context"),
    _currentValue: null as never,
    _currentValue2: null as never,
    _threadCount: 0,
    Consumer: null as never,
    Provider: null as never,
  },

  setCurrentUpdatePriority() {},
  getCurrentUpdatePriority() {
    return 16;
  },
  resolveUpdatePriority() {
    return 16;
  },

  shouldAttemptEagerTransition() {
    return false;
  },

  requestPostPaintCallback() {},

  getInstanceFromNode() {
    return null;
  },

  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},

  prepareScopeUpdate() {},
  getInstanceFromScope() {
    return null;
  },

  detachDeletedInstance() {},
  preparePortalMount() {},

  maySuspendCommit() {
    return false;
  },
  preloadInstance() {
    return true;
  },
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady() {
    return null;
  },
  resetFormInstance() {},

  trackSchedulerEvent() {},
  resolveEventType() {
    return null;
  },
  resolveEventTimeStamp() {
    return -1.1;
  },
};
