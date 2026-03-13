import type { ReactNode } from "react";
import type { TuiProps } from "./dom";

type TuiElementProps = TuiProps & { children?: ReactNode };

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "tui-root": TuiElementProps;
      "tui-box": TuiElementProps;
      "tui-text": TuiElementProps;
      "tui-static": TuiElementProps;
      "tui-virtual": TuiElementProps;
    }
  }
}
