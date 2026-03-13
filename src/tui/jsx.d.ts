import type { TuiProps } from "./dom";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "tui-root": TuiProps & { children?: React.ReactNode };
      "tui-box": TuiProps & { children?: React.ReactNode };
      "tui-text": TuiProps & { children?: React.ReactNode };
      "tui-static": TuiProps & { children?: React.ReactNode };
      "tui-virtual": TuiProps & { children?: React.ReactNode };
    }
  }
}
