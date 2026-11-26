// Geometry for the Pattern Trails scenes (map and path), kept pure so it can be
// unit tested. Everything is in scene units; the scene SVG uses the same
// viewBox and the HTML overlays (stops, signs, Kojo) are placed in percent of
// it, so the whole scene scales with its container.

export type Point = { x: number; y: number };
export type Orientation = "horizontal" | "vertical";
/** One cubic Bezier between two neighboring stops. */
export type Segment = { p0: Point; c1: Point; c2: Point; p1: Point };

export type TrailLayout = {
  orientation: Orientation;
  width: number;
  height: number;
  points: Point[];
  segments: Segment[];
  /** SVG path data through every point. */
  d: string;
  /** Cumulative arc length at each point (0 at the first, `total` at the last). */
  lengths: number[];
  total: number;
};

/** Scene sizes per orientation. Vertical grows with the number of stops. */
export const HORIZONTAL = { width: 1000, height: 560, marginX: 80, high: 300, low: 430 } as const;
export const VERTICAL = { width: 400, gap: 150, padTop: 150, padBottom: 110, left: 120, right: 280 } as const;

function round(n: number) {
  return Math.round(n * 10) / 10;
}

/**
 * Stops along a gently winding trail: left to right on wide screens (alternating
 * high and low), bottom to top on phones (alternating left and right).
 */
export function trailLayout(count: number, orientation: Orientation, marginX: number = HORIZONTAL.marginX): TrailLayout {
  const n = Math.max(count, 1);
  let width: number;
  let height: number;
  const points: Point[] = [];
  if (orientation === "horizontal") {
    width = HORIZONTAL.width;
    height = HORIZONTAL.height;
    const span = width - marginX * 2;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? width / 2 : marginX + (span * i) / (n - 1);
      // The trail starts low and climbs a little toward the finish.
      const climb = n === 1 ? 0 : (i / (n - 1)) * 70;
      const y = (i % 2 === 0 ? HORIZONTAL.low : HORIZONTAL.high) - climb;
      points.push({ x: round(x), y: round(y) });
    }
  } else {
    width = VERTICAL.width;
    height = VERTICAL.padTop + VERTICAL.padBottom + VERTICAL.gap * (n - 1);
    for (let i = 0; i < n; i++) {
      const y = height - VERTICAL.padBottom - VERTICAL.gap * i;
      const x = i % 2 === 0 ? VERTICAL.left : VERTICAL.right;
      points.push({ x, y });
    }
  }
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    // S-curves: horizontal handles for a horizontal trail, vertical for vertical.
    const seg =
      orientation === "horizontal"
        ? { p0, c1: { x: (p0.x + p1.x) / 2, y: p0.y }, c2: { x: (p0.x + p1.x) / 2, y: p1.y }, p1 }
        : { p0, c1: { x: p0.x, y: (p0.y + p1.y) / 2 }, c2: { x: p1.x, y: (p0.y + p1.y) / 2 }, p1 };
    segments.push(seg);
  }
  const d =
    `M${points[0].x} ${points[0].y}` +
    segments.map((s) => ` C${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.p1.x} ${s.p1.y}`).join("");
  const lengths = [0];
  for (const s of segments) lengths.push(lengths[lengths.length - 1] + segmentLength(s));
  return { orientation, width, height, points, segments, d, lengths, total: lengths[lengths.length - 1] };
}

export function bezierPoint(s: Segment, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + e * s.p1.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + e * s.p1.y,
  };
}

const SAMPLES = 48;

function segmentLength(s: Segment): number {
  let length = 0;
  let prev = s.p0;
  for (let i = 1; i <= SAMPLES; i++) {
    const p = bezierPoint(s, i / SAMPLES);
    length += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return length;
}

/** The point at arc length `distance` along the trail (clamped to its ends). */
export function pointAtLength(layout: TrailLayout, distance: number): Point {
  const { segments, lengths, total, points } = layout;
  if (!segments.length) return points[0];
  const target = Math.min(Math.max(distance, 0), total);
  let i = 0;
  while (i < segments.length - 1 && lengths[i + 1] < target) i++;
  const seg = segments[i];
  const segLen = lengths[i + 1] - lengths[i] || 1;
  // Walk the samples of this segment to turn length into the Bezier parameter.
  const want = target - lengths[i];
  let acc = 0;
  let prev = seg.p0;
  for (let k = 1; k <= SAMPLES; k++) {
    const p = bezierPoint(seg, k / SAMPLES);
    const step = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (acc + step >= want) {
      const f = step ? (want - acc) / step : 0;
      return { x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f };
    }
    acc += step;
    prev = p;
  }
  return want >= segLen ? seg.p1 : prev;
}

/** How far behind a stop Kojo stands, so the stop itself stays visible. */
export const KOJO_BACKSTEP = 64;

/**
 * Kojo's spot for a distance along the trail. Distances before the start (the
 * spot behind the first stop) extend the trail's opening direction.
 */
export function kojoPoint(layout: TrailLayout, distance: number): Point {
  if (distance >= 0) return pointAtLength(layout, distance);
  if (!layout.segments.length) {
    const p = layout.points[0];
    return layout.orientation === "horizontal" ? { x: p.x + distance, y: p.y } : { x: p.x, y: p.y - distance };
  }
  const s = layout.segments[0];
  const dx = s.c1.x - s.p0.x;
  const dy = s.c1.y - s.p0.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: s.p0.x + (dx / len) * distance, y: s.p0.y + (dy / len) * distance };
}

/**
 * The resting distance for Kojo at stop `index`: just behind it on a path (the
 * stop stays visible), just past it on the map (Kojo heads for the next land).
 */
export function kojoRest(layout: TrailLayout, index: number, ahead = false): number {
  const i = Math.min(Math.max(index, 0), layout.points.length - 1);
  // On a tall trail the signs sit beside the stops, so Kojo keeps further back.
  const step = layout.orientation === "vertical" ? KOJO_BACKSTEP + 28 : KOJO_BACKSTEP;
  return layout.lengths[i] + (ahead ? step : -step);
}

/** Ease in and out (smooth start, settle at the stop). */
export function easeInOut(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** How long Kojo walks from one stop to another: 1.8s a stop, capped. */
export function walkDuration(fromIndex: number, toIndex: number): number {
  return Math.min(1800 * Math.max(Math.abs(toIndex - fromIndex), 1), 3600);
}

/**
 * Where a stop's signpost goes so neighbors never collide: horizontal trails
 * put it above the high stops and below the low ones (the side away from the
 * trail's bend); vertical trails put it on the outer side of the bend.
 */
export function signSide(layout: TrailLayout, index: number): "above" | "below" | "left" | "right" {
  const p = layout.points[index];
  if (layout.orientation === "horizontal") return p.y <= HORIZONTAL.high ? "above" : "below";
  return p.x < layout.width / 2 ? "right" : "left";
}

/** A point as percentages of the scene, for HTML overlays placed on top of it. */
export function toPercent(layout: TrailLayout, p: Point): { left: string; top: string } {
  return { left: `${round((p.x / layout.width) * 100)}%`, top: `${round((p.y / layout.height) * 100)}%` };
}
