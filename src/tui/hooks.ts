import { useContext, useEffect, useRef } from "react";
import { AppContext, type InputHandler, InputContext } from "./context";

export function useApp(): { exit: () => void } {
  return useContext(AppContext);
}

export function useInput(handler: InputHandler, options?: { isActive?: boolean }): void {
  const ctx = useContext(InputContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const isActive = options?.isActive ?? true;

  useEffect(() => {
    const unregister = ctx.register({
      handler: (input, key) => handlerRef.current(input, key),
      isActive,
    });
    return unregister;
  }, [ctx, isActive]);
}
