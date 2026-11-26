import { KOJO_LEG_COLUMNS, KOJO_LEG_ROW, KOJO_SPRITE, KOJO_SPRITE_COLS, KOJO_SPRITE_ROWS } from "../lib/kojoSprite";
import "../styles/components/kojo-sprite.css";

type Cell = { x: number; y: number; tone: "body" | "light" | "ink" };

// Runs of equal cells on a row merge into one rect: fewer nodes, no hairline seams.
const CELLS: (Cell & { w: number })[] = (() => {
  const out: (Cell & { w: number })[] = [];
  KOJO_SPRITE.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === ".") {
        x += 1;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w += 1;
      out.push({ x, y, w, tone: ch === "b" ? "light" : ch === "e" || ch === "n" ? "ink" : "body" });
      x += w;
    }
  });
  return out;
})();

function Leg({ column, className }: { column: number; className: string }) {
  return (
    <g className={className}>
      <rect x={column} y={KOJO_LEG_ROW} width={2} height={1} className="kojo-sprite-body" />
      <rect x={column} y={KOJO_LEG_ROW + 1} width={2} height={1} className="kojo-sprite-ink" />
    </g>
  );
}

/**
 * Kojo as crisp SVG pixels, sized by `width` (height follows the 14x11 grid).
 * `walking` runs a two-frame leg cycle. Colors are tokens (green-dark body,
 * green-light belly and muzzle, ink eye, nose and paws).
 */
export function KojoSprite({
  width = 70,
  walking = false,
  label,
  className = "",
}: {
  width?: number | string;
  walking?: boolean;
  /** Accessible name; omit when the sprite is decoration next to text that says the same. */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      className={`kojo-sprite${walking ? " is-walking" : ""}${className ? " " + className : ""}`}
      width={width}
      viewBox={`0 0 ${KOJO_SPRITE_COLS} ${KOJO_SPRITE_ROWS}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {CELLS.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={c.w} height={1} className={`kojo-sprite-${c.tone}`} />
      ))}
      <Leg column={KOJO_LEG_COLUMNS.back} className="kojo-sprite-leg kojo-sprite-leg--a" />
      <Leg column={KOJO_LEG_COLUMNS.front} className="kojo-sprite-leg kojo-sprite-leg--b" />
    </svg>
  );
}
