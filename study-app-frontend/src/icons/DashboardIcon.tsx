import { forwardRef, type ReactNode } from "react";
import { Icon, type IconProps } from "./Icon";

// Dashboard home. Blocky masonry: a tall and a short tile per column, softly rounded.
// On hover the tiles shuffle (tall and short swap places in each column), then settle back.
// Tiles keep their size and only translate, so the filled state never merges.
const TILES: [string, number, number, number, number][] = [
  ["tl", 3, 3, 7, 9],
  ["bl", 3, 16, 7, 5],
  ["tr", 14, 3, 7, 5],
  ["br", 14, 12, 7, 9],
];

function tile([key, x, y, w, h]: (typeof TILES)[number]): ReactNode {
  return (
    <g key={key} className={`icon-part-${key}`}>
      <rect className="icon-fill" x={x} y={y} width={w} height={h} rx="1.75" fill="currentColor" stroke="none" />
      <rect x={x} y={y} width={w} height={h} rx="1.75" />
    </g>
  );
}

export const DashboardIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="dashboard" {...props}>
    {TILES.map(tile)}
  </Icon>
));
DashboardIcon.displayName = "DashboardIcon";
