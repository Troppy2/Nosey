import { forwardRef, type ReactNode } from "react";
import { Icon, type IconProps } from "./Icon";

// Directional glyphs are drawn once pointing right and rotated per direction,
// so all four stay optically identical.
const ROT = { right: 0, down: 90, left: 180, up: 270 } as const;
type Dir = keyof typeof ROT;

function make(kind: "chevron" | "arrow", dir: Dir, body: ReactNode, displayName: string) {
  const C = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <Icon ref={ref} name={`${kind} icon-${kind}-${dir}`} {...props}>
      <g transform={ROT[dir] ? `rotate(${ROT[dir]} 12 12)` : undefined}>
        <g className={`icon-part-${kind}`}>{body}</g>
      </g>
    </Icon>
  ));
  C.displayName = displayName;
  return C;
}

// Chevron: short squat V with a rounded tip. Not Lucide ChevronRight (12px tall, sharp tip).
const CHEVRON = <path d="M10 7.5L13.6 11.1Q14.5 12 13.6 12.9L10 16.5" />;
export const ChevronRightIcon = make("chevron", "right", CHEVRON, "ChevronRightIcon");
export const ChevronDownIcon = make("chevron", "down", CHEVRON, "ChevronDownIcon");
export const ChevronLeftIcon = make("chevron", "left", CHEVRON, "ChevronLeftIcon");
export const ChevronUpIcon = make("chevron", "up", CHEVRON, "ChevronUpIcon");

// Arrow: pill shaft with a rounded head. Not Lucide ArrowRight (sharp 90 degree head).
const ARROW = (
  <>
    <path d="M5.5 12H17.5" />
    <path d="M13.5 7.5L17.4 11.2Q18.2 12 17.4 12.8L13.5 16.5" />
  </>
);
export const ArrowRightIcon = make("arrow", "right", ARROW, "ArrowRightIcon");
export const ArrowDownIcon = make("arrow", "down", ARROW, "ArrowDownIcon");
export const ArrowLeftIcon = make("arrow", "left", ARROW, "ArrowLeftIcon");
export const ArrowUpIcon = make("arrow", "up", ARROW, "ArrowUpIcon");
