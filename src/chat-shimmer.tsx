import { Text } from "ink";
import type React from "react";

const DIM_R = 0x55;
const DIM_G = 0x55;
const DIM_B = 0x55;
const BRIGHT_R = 0x99;
const BRIGHT_G = 0x99;
const BRIGHT_B = 0x99;
const SWEEP_WIDTH = 12;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function toHex(r: number, g: number, b: number): string {
  return `#${Math.round(r).toString(16).padStart(2, "0")}${Math.round(g).toString(16).padStart(2, "0")}${Math.round(b).toString(16).padStart(2, "0")}`;
}

export function shimmerColor(charIndex: number, sweepPos: number, sweepWidth: number): string {
  const dist = Math.abs(charIndex - sweepPos);
  if (dist >= sweepWidth) return toHex(DIM_R, DIM_G, DIM_B);
  const t = 0.5 * (1 + Math.cos((Math.PI * dist) / sweepWidth));
  return toHex(lerp(DIM_R, BRIGHT_R, t), lerp(DIM_G, BRIGHT_G, t), lerp(DIM_B, BRIGHT_B, t));
}

interface ShimmerTextProps {
  text: string;
  frame: number;
  totalFrames: number;
}

export function ShimmerText({ text, frame, totalFrames }: ShimmerTextProps): React.ReactNode {
  if (text.length === 0) return null;
  const range = text.length + SWEEP_WIDTH * 2;
  const sweepPos = (frame / totalFrames) * range - SWEEP_WIDTH;
  return (
    <Text>
      {[...text].map((ch, i) => {
        const key = `${i}-${ch}`;
        return (
          <Text key={key} color={shimmerColor(i, sweepPos, SWEEP_WIDTH)}>
            {ch}
          </Text>
        );
      })}
    </Text>
  );
}
