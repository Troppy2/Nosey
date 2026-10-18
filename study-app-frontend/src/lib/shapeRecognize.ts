// Turns a freehand stroke into a clean shape, for the scratch pad's
// "hold at the end of a stroke to snap" gesture (like Samsung Notes'
// shape recognition). Points are a flat [x0,y0,x1,y1,...] array in the pad's
// logical units. Pure and DOM-free so it can be unit tested.

export type ShapeKind = "line" | "ellipse" | "rect" | "triangle" | "star";

export type RecognizedShape = {
  kind: ShapeKind;
  points: number[];
  // Drawn as straight segments (corners stay sharp) rather than a spline.
  straight: boolean;
  // The point the shape resizes and rotates around while it is adjusted.
  cx: number;
  cy: number;
};

// Smaller than this (logical units, bounding box diagonal) is handwriting,
// not a shape: an "o" with a pause after it must stay an "o".
// Tuned with a stress test: at 36 a neatly written "o" snapped every time.
const MIN_SHAPE_SIZE = 60;
const MIN_LINE_LENGTH = 20;
const ELLIPSE_SEGMENTS = 72;
const STAR_INNER_RATIO = 0.382;

type Pt = [number, number];

function toPts(points: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push([points[i], points[i + 1]]);
  return out;
}

function flat(pts: Pt[]): number[] {
  const out: number[] = [];
  for (const [x, y] of pts) out.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  return out;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function distToLine(p: Pt, a: Pt, b: Pt): number {
  const len = dist(a, b);
  if (len === 0) return dist(p, a);
  return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
}

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1;
    let bestD = eps;
    for (let i = s + 1; i < e; i++) {
      const d = distToLine(pts[i], pts[s], pts[e]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = true;
      stack.push([s, best], [best, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Corners of a closed stroke: RDP vertices with the closing duplicate and any
// near-straight vertex (the stroke may start mid-edge) removed.
function closedCorners(pts: Pt[], eps: number): Pt[] {
  let v = rdp(pts, eps);
  if (v.length > 1 && dist(v[0], v[v.length - 1]) < eps * 2.5) v = v.slice(0, -1);
  let changed = true;
  while (changed && v.length > 3) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const a = v[(i - 1 + v.length) % v.length];
      const b = v[i];
      const c = v[(i + 1) % v.length];
      const ab = [b[0] - a[0], b[1] - a[1]];
      const bc = [c[0] - b[0], c[1] - b[1]];
      const turn = Math.abs(Math.atan2(ab[0] * bc[1] - ab[1] * bc[0], ab[0] * bc[0] + ab[1] * bc[1]));
      if (turn < (25 * Math.PI) / 180 || dist(a, b) < eps) {
        v.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return v;
}

function bounds(pts: Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, theta = 0): Pt[] {
  const out: Pt[] = [];
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) {
    const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}

function starPoints(cx: number, cy: number, r: number, startAngle: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = startAngle + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * STAR_INNER_RATIO;
    out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return out;
}

function rectFrom(pts: Pt[], corners: Pt[]): Pt[] {
  // Orientation from the longest edge, snapped level when it nearly is.
  let theta = 0;
  let longest = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const d = dist(a, b);
    if (d > longest) {
      longest = d;
      theta = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  const quarter = Math.PI / 2;
  theta -= Math.round(theta / quarter) * quarter;
  if (Math.abs(theta) < (8 * Math.PI) / 180) theta = 0;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, y] of pts) {
    const u = x * ux + y * uy;
    const v = -x * uy + y * ux;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  // A near-square becomes a square.
  const w = maxU - minU;
  const h = maxV - minV;
  if (Math.abs(w - h) / Math.max(w, h) < 0.12) {
    const side = (w + h) / 2;
    const mu = (minU + maxU) / 2;
    const mv = (minV + maxV) / 2;
    minU = mu - side / 2;
    maxU = mu + side / 2;
    minV = mv - side / 2;
    maxV = mv + side / 2;
  }
  const back = (u: number, v: number): Pt => [u * ux - v * uy, u * uy + v * ux];
  return [back(minU, minV), back(maxU, minV), back(maxU, maxV), back(minU, maxV), back(minU, minV)];
}

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

function make(kind: ShapeKind, pts: Pt[], straight: boolean, c: Pt): RecognizedShape {
  return { kind, points: flat(pts), straight, cx: c[0], cy: c[1] };
}

export function recognizeShape(points: number[], allowed: readonly ShapeKind[]): RecognizedShape | null {
  const pts = toPts(points);
  if (pts.length < 4) return null;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const b = bounds(pts);
  const size = Math.hypot(b.w, b.h);

  // Line: the ends are nearly as far apart as the path is long, and nothing
  // strays far from the chord.
  const chord = dist(first, last);
  // Path length is measured on a lightly simplified copy: raw hand jitter
  // inflates it and made shaky lines fail.
  const smooth = rdp(pts, Math.max(2, chord * 0.02));
  let smoothLength = 0;
  for (let i = 1; i < smooth.length; i++) smoothLength += dist(smooth[i - 1], smooth[i]);
  if (allowed.includes("line") && chord >= MIN_LINE_LENGTH && chord / Math.max(smoothLength, 1) > 0.9) {
    let dev = 0;
    for (const p of pts) dev = Math.max(dev, distToLine(p, first, last));
    if (dev < Math.max(5, chord * 0.08)) {
      return make("line", [first, last], true, [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2]);
    }
  }

  if (size < MIN_SHAPE_SIZE) return null;
  // Closed: the stroke ends near where it began.
  if (chord > size * 0.3) return null;

  // Ellipse: every point about one unit from the centre in the box's
  // normalised space.
  // Axis from the points' principal direction, so a tilted ellipse fits too
  // (the page-aligned box alone missed every tilted one).
  if (allowed.includes("ellipse") && b.w > 0 && b.h > 0) {
    const [mx, my] = centroid(pts);
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const [x, y] of pts) {
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
      sxy += (x - mx) * (y - my);
    }
    let theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    if (Math.abs(theta) < (8 * Math.PI) / 180) theta = 0;
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of pts) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    let rx = (maxU - minU) / 2;
    let ry = (maxV - minV) / 2;
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    const cx = cu * ux - cv * uy;
    const cy = cu * uy + cv * ux;
    if (rx > 0 && ry > 0) {
      let err = 0;
      for (const [x, y] of pts) {
        const u = (x - cx) * ux + (y - cy) * uy;
        const v = -(x - cx) * uy + (y - cy) * ux;
        err += Math.abs(Math.hypot(u / rx, v / ry) - 1);
      }
      err /= pts.length;
      if (err < 0.085) {
        if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) {
          rx = ry = (rx + ry) / 2;
          theta = 0;
        }
        return make("ellipse", ellipsePoints(cx, cy, rx, ry, theta), false, [cx, cy]);
      }
    }
  }

  const corners = closedCorners(pts, size * 0.07);
  const c = centroid(corners);

  if (corners.length === 3 && allowed.includes("triangle")) {
    return make("triangle", [...corners, corners[0]], true, c);
  }
  if (corners.length === 4 && allowed.includes("rect")) {
    const rect = rectFrom(pts, corners);
    return make("rect", rect, true, centroid(rect.slice(0, 4)));
  }
  if (allowed.includes("star")) {
    // Drawn as a pentagram (five crossing strokes: five sharp tips), or as an
    // outline (ten corners alternating far and near).
    let tips: Pt[] | null = null;
    if (corners.length === 5) {
      // A pentagram jumps two tips around the centre per stroke (about 144
      // degrees); a pentagon steps to the next one (72) and is not a star.
      const pc = centroid(corners);
      const ang = corners.map((p) => Math.atan2(p[1] - pc[1], p[0] - pc[0]));
      const isPentagram = ang.every((a0, i) => {
        let d = Math.abs(ang[(i + 1) % 5] - a0) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return Math.abs(d - (144 * Math.PI) / 180) < (35 * Math.PI) / 180;
      });
      if (isPentagram) tips = corners;
    } else if (corners.length >= 9 && corners.length <= 11) {
      // The five farthest corners are the tips (a strict "above the median"
      // test only ever found four of ten, so outlined stars never matched).
      const order = corners.map((_, i) => i).sort((i, j) => dist(corners[j], c) - dist(corners[i], c));
      const outerIdx = new Set(order.slice(0, 5));
      const outer = corners.filter((_, i) => outerIdx.has(i));
      const innerMax = Math.max(...corners.filter((_, i) => !outerIdx.has(i)).map((p) => dist(p, c)));
      const outerMin = Math.min(...outer.map((p) => dist(p, c)));
      if (outerMin > innerMax * 1.3) tips = outer;
    }
    if (tips) {
      const tc = centroid(tips);
      const radius = tips.reduce((sum, p) => sum + dist(p, tc), 0) / tips.length;
      // A real star's tips are evenly spread; five corners of a lumpy circle are not star tips.
      const spread = tips.every((p) => Math.abs(dist(p, tc) - radius) < radius * 0.3);
      if (spread) {
        const start = Math.atan2(tips[0][1] - tc[1], tips[0][0] - tc[0]);
        return make("star", starPoints(tc[0], tc[1], radius, start), true, tc);
      }
    }
  }
  return null;
}
