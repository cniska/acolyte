import { createContext } from "react";

export type AppContextValue = {
  exit: () => void;
};

export const AppContext = createContext<AppContextValue>({ exit: () => {} });

export type InputHandler = (input: string, key: KeyEvent) => void;

export type KeyEvent = {
  return: boolean;
  tab: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  super: boolean;
  escape: boolean;
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  home: boolean;
  end: boolean;
  backspace: boolean;
  delete: boolean;
};

export type InputRegistration = {
  handler: InputHandler;
  isActive: boolean;
};

export type InputContextValue = {
  register: (reg: InputRegistration) => () => void;
};

export const InputContext = createContext<InputContextValue>({
  register: () => () => {},
});
