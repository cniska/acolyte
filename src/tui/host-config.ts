import {
  appendChild,
  createElement,
  createTextNode,
  insertBefore,
  removeChild,
  type TuiElement,
  type TuiNode,
  type TuiNodeType,
  type TuiProps,
  type TuiTextNode,
} from "./dom";

type Props = TuiProps & { children?: unknown };

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

  createTextInstance(text: string): TuiTextNode {
    return createTextNode(text);
  },

  appendInitialChild(parent: TuiElement, child: TuiNode) {
    appendChild(parent, child);
  },

  appendChild(parent: TuiElement, child: TuiNode) {
    appendChild(parent, child);
  },

  appendChildToContainer(container: TuiElement, child: TuiNode) {
    appendChild(container, child);
  },

  removeChild(parent: TuiElement, child: TuiNode) {
    removeChild(parent, child);
  },

  removeChildFromContainer(container: TuiElement, child: TuiNode) {
    removeChild(container, child);
  },

  insertBefore(parent: TuiElement, child: TuiNode, before: TuiNode) {
    insertBefore(parent, child, before);
  },

  insertInContainerBefore(container: TuiElement, child: TuiNode, before: TuiNode) {
    insertBefore(container, child, before);
  },

  commitUpdate(instance: TuiElement, _type: TuiNodeType, _oldProps: Props, newProps: Props) {
    instance.props = propsFromRaw(newProps);
  },

  commitTextUpdate(textInstance: TuiTextNode, _oldText: string, newText: string) {
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
  noTimeout: -1,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,

  NotPendingTransition: null,
  HostTransitionContext: {
    $$typeof: Symbol.for("react.context"),
    _currentValue: null,
    _currentValue2: null,
    _threadCount: 0,
    Consumer: null,
    Provider: null,
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
