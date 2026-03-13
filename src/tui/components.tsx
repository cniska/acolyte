import type React from "react";

type BoxProps = {
  flexDirection?: "row" | "column";
  width?: number;
  children?: React.ReactNode;
  key?: React.Key;
};

type TextProps = {
  color?: string;
  dimColor?: boolean;
  backgroundColor?: string;
  bold?: boolean;
  underline?: boolean;
  inverse?: boolean;
  children?: React.ReactNode;
  key?: React.Key;
};

type StaticProps<T> = {
  items: T[];
  children: (item: T, index: number) => React.ReactNode;
};

export function Box(props: BoxProps): React.ReactElement {
  return (
    <tui-box flexDirection={props.flexDirection} width={props.width}>
      {props.children}
    </tui-box>
  );
}

export function Text(props: TextProps): React.ReactElement {
  return (
    <tui-text
      color={props.color}
      dimColor={props.dimColor}
      backgroundColor={props.backgroundColor}
      bold={props.bold}
      underline={props.underline}
      inverse={props.inverse}
    >
      {props.children}
    </tui-text>
  );
}

export function Static<T extends { id?: string }>(props: StaticProps<T>): React.ReactElement {
  const children = props.items.map((item, index) => {
    const key = item.id ?? index;
    const child = props.children(item, index);
    return <tui-virtual key={key}>{child}</tui-virtual>;
  });
  return <tui-static internal_static>{children}</tui-static>;
}
