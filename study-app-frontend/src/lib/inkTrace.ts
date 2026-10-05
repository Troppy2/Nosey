// Turns a photo or screenshot of handwriting into pen strokes, on the device,
// with no AI: threshold the ink, thin it to a one pixel skeleton (Zhang-Suen),
// then walk the skeleton into polylines. Strokes come out as flat
// [x0, y0, x1, y1, ...] arrays in image pixels, ready to be scaled onto the
// scratch pad. Light colors (a yellow highlighter) fall below the ink
// threshold and are dropped, so only the pen marks are kept.

export type RawImage = { data: Uint8ClampedArray; width: number; height: number };

export type TraceResult = {
  strokes: number[][];
  width: number;
  height: number;
};

// A ceiling on the threshold so a mid-gray highlighter is never read as ink,
// whatever Otsu picks for a page that is mostly white.
const MAX_INK_THRESHOLD = 185;
// Ink blobs smaller than this many pixels are speckle, not writing.
const MIN_BLOB_PIXELS = 6;
// A skeleton branch this short that ends at a junction is thinning noise.
const MAX_SPUR_LENGTH = 7;
const SIMPLIFY_EPSILON = 0.9;

const N8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
];

function luminance(img: RawImage): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const alpha = data[p + 3] / 255;
    // Composite over white so a transparent PNG background reads as paper.
    const r = data[p] * alpha + 255 * (1 - alpha);
    const g = data[p + 1] * alpha + 255 * (1 - alpha);
    const b = data[p + 2] * alpha + 255 * (1 - alpha);
    out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

function otsuThreshold(lum: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < lum.length; i++) hist[Math.max(0, Math.min(255, Math.round(lum[i])))]++;
  const total = lum.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

// Removes connected ink blobs below MIN_BLOB_PIXELS.
function despeckle(mask: Uint8Array, width: number, height: number): void {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const blob: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      blob.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (mask[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (blob.length < MIN_BLOB_PIXELS) for (const p of blob) mask[p] = 0;
  }
}

// True when removing the ink pixel at i keeps its neighborhood in one piece
// and does not shorten a line end (the two Zhang-Suen safety conditions).
function removable(mask: Uint8Array, i: number, width: number): boolean {
  const p2 = mask[i - width];
  const p3 = mask[i - width + 1];
  const p4 = mask[i + 1];
  const p5 = mask[i + width + 1];
  const p6 = mask[i + width];
  const p7 = mask[i + width - 1];
  const p8 = mask[i - 1];
  const p9 = mask[i - width - 1];
  const neighbors = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
  if (neighbors < 2 || neighbors > 6) return false;
  const transitions =
    (!p2 && p3 ? 1 : 0) + (!p3 && p4 ? 1 : 0) + (!p4 && p5 ? 1 : 0) + (!p5 && p6 ? 1 : 0) +
    (!p6 && p7 ? 1 : 0) + (!p7 && p8 ? 1 : 0) + (!p8 && p9 ? 1 : 0) + (!p9 && p2 ? 1 : 0);
  return transitions === 1;
}

// Zhang-Suen thinning, in place. The mask must have a one pixel empty border.
export function thin(mask: Uint8Array, width: number, height: number): void {
  const toClear: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      toClear.length = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          if (!mask[i]) continue;
          const p2 = mask[i - width];
          const p3 = mask[i - width + 1];
          const p4 = mask[i + 1];
          const p5 = mask[i + width + 1];
          const p6 = mask[i + width];
          const p7 = mask[i + width - 1];
          const p8 = mask[i - 1];
          const p9 = mask[i - width - 1];
          const neighbors = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (neighbors < 2 || neighbors > 6) continue;
          const transitions =
            (!p2 && p3 ? 1 : 0) + (!p3 && p4 ? 1 : 0) + (!p4 && p5 ? 1 : 0) + (!p5 && p6 ? 1 : 0) +
            (!p6 && p7 ? 1 : 0) + (!p7 && p8 ? 1 : 0) + (!p8 && p9 ? 1 : 0) + (!p9 && p2 ? 1 : 0);
          if (transitions !== 1) continue;
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) {
            continue;
          }
          toClear.push(i);
        }
      }
      // Candidates are all picked from the same snapshot, so two touching
      // pixels of a 2-pixel-wide diagonal can both qualify and erase the whole
      // line. Each is re-checked against the mask as it now stands.
      for (const i of toClear) {
        if (removable(mask, i, width)) {
          mask[i] = 0;
          changed = true;
        }
      }
    }
  }
}

function simplify(points: number[], epsilon: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const ax = points[a * 2];
    const ay = points[a * 2 + 1];
    const dx = points[b * 2] - ax;
    const dy = points[b * 2 + 1] - ay;
    const lenSq = dx * dx + dy * dy;
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = points[i * 2] - ax;
      const py = points[i * 2 + 1] - ay;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
      const dist = Math.hypot(px - t * dx, py - t * dy);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([a, maxIdx], [maxIdx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

type Path = { pixels: number[]; startKind: number; endKind: number; startNode: number; endNode: number };

type Skeleton = { paths: Path[]; centroidOf: (pixel: number) => [number, number] | null };

// Walks the skeleton into pixel paths between line ends and junctions. Pixels
// where branches meet form clusters; every path that reaches a cluster is
// snapped to the cluster's centre, so a crossing is one clean meeting point.
export function walkSkeleton(sk: Uint8Array, width: number, height: number): Skeleton {
  // Pixels are classified by crossing number (how many separate runs of ink
  // neighbors surround them): 0 an isolated dot, 1 an endpoint, 2 the middle
  // of a line, 3+ a junction. Counting touching neighbors instead would call
  // every corner of a staircase-shaped diagonal a junction and shatter the
  // strokes. A wider ring was tried and swallowed short strokes like a "+".
  const kind = new Uint8Array(sk.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (!sk[i]) continue;
      let runs = 0;
      for (let k = 0; k < 8; k++) {
        const [ax, ay] = N8[k];
        const [bx, by] = N8[(k + 1) % 8];
        if (!sk[i + ay * width + ax] && sk[i + by * width + bx]) runs++;
      }
      // A pixel fully ringed by ink has no 0 to 1 transition but is not a line.
      kind[i] = runs === 0 ? (N8.some(([dx, dy]) => sk[i + dy * width + dx]) ? 3 : 0) : Math.min(runs, 3);
    }
  }
  const isNode = (i: number) => kind[i] !== 2;

  // Group junction/end pixels into clusters and find each one's centre.
  const cluster = new Int32Array(sk.length).fill(-1);
  const centres: Array<[number, number]> = [];
  const stack: number[] = [];
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i] || !isNode(i) || cluster[i] !== -1) continue;
    const id = centres.length;
    let sx = 0;
    let sy = 0;
    let n = 0;
    stack.push(i);
    cluster[i] = id;
    while (stack.length) {
      const p = stack.pop() as number;
      const px = p % width;
      sx += px;
      sy += (p - px) / width;
      n++;
      for (const [dx, dy] of N8) {
        const q = p + dy * width + dx;
        if (sk[q] && isNode(q) && cluster[q] === -1) {
          cluster[q] = id;
          stack.push(q);
        }
      }
    }
    centres.push([sx / n, sy / n]);
  }
  const centroidOf = (pixel: number): [number, number] | null => (cluster[pixel] >= 0 ? centres[cluster[pixel]] : null);

  const visited = new Uint8Array(sk.length);
  const paths: Path[] = [];
  // Orthogonal neighbors first, so a walk prefers the straight step over a
  // diagonal that skips a corner pixel.
  const ORDER: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1],
  ];
  const neighborsOf = (i: number): number[] => {
    const out: number[] = [];
    for (const [dx, dy] of ORDER) {
      const q = i + dy * width + dx;
      if (sk[q]) out.push(q);
    }
    return out;
  };
  const adjacent = (a: number, b: number) => {
    const ax = a % width;
    const bx = b % width;
    return Math.abs(ax - bx) <= 1 && Math.abs((a - ax) / width - (b - bx) / width) <= 1;
  };

  function follow(start: number, first: number): Path {
    const pixels = [start, first];
    let prev = start;
    let cur = first;
    if (!isNode(cur)) visited[cur] = 1;
    while (!isNode(cur)) {
      const around = neighborsOf(cur).filter((q) => q !== prev && !visited[q] && q !== start);
      const next = around[0];
      if (next === undefined) break;
      // Redundant corner pixels (touching both the pixel behind and the one
      // ahead) belong to the same line; mark them so they never start a path.
      for (const q of around) if (q !== next && !isNode(q) && adjacent(q, prev) && adjacent(q, next)) visited[q] = 1;
      pixels.push(next);
      prev = cur;
      cur = next;
      if (!isNode(cur)) visited[cur] = 1;
    }
    return { pixels, startKind: kind[start], endKind: kind[cur], startNode: start, endNode: cur };
  }

  for (let i = 0; i < sk.length; i++) {
    if (!sk[i] || !isNode(i)) continue;
    if (kind[i] === 0) {
      paths.push({ pixels: [i], startKind: 0, endKind: 0, startNode: i, endNode: i });
      continue;
    }
    for (const q of neighborsOf(i)) {
      // A hop inside one cluster is covered by the cluster's centre.
      if (!isNode(q) && !visited[q]) paths.push(follow(i, q));
    }
  }
  // What is left unvisited is a closed loop with no endpoint or junction, or a
  // stretch between two clusters that the walks above never entered.
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i] || visited[i] || isNode(i)) continue;
    visited[i] = 1;
    // Out in both directions from an arbitrary pixel, so a line the endpoint
    // walks never reached comes back as one stroke, not two halves.
    const walkOut = (from: number): number[] => {
      const out: number[] = [];
      let cur = from;
      for (;;) {
        const next = neighborsOf(cur).find((q) => !visited[q] && !isNode(q));
        if (next === undefined) return out;
        visited[next] = 1;
        out.push(next);
        cur = next;
      }
    };
    const forward = walkOut(i);
    const backward = walkOut(i);
    const line = [...backward.reverse(), i, ...forward];
    // A true closed loop ends next to where it began; an open run does not,
    // and closing it would draw a chord across the writing.
    if (line.length >= 3 && adjacent(line[0], line[line.length - 1])) line.push(line[0]);
    if (line.length >= 6) {
      paths.push({ pixels: line, startKind: 2, endKind: 2, startNode: -1, endNode: -1 });
    }
  }
  return { paths, centroidOf };
}

// Doubles a small image with bilinear filtering. Thin pen lines are one or two
// pixels wide and anti-aliased, so thresholding them as they are leaves gaps;
// upscaled first, the faint pixels fill in and the line stays whole.
function upscale2x(lum: Float32Array, width: number, height: number): Float32Array {
  const w2 = width * 2;
  const out = new Float32Array(w2 * height * 2);
  for (let y = 0; y < height * 2; y++) {
    const sy = Math.min(height - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < w2; x++) {
      const sx = Math.min(width - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      const top = lum[y0 * width + x0] * (1 - fx) + lum[y0 * width + x1] * fx;
      const bottom = lum[y1 * width + x0] * (1 - fx) + lum[y1 * width + x1] * fx;
      out[y * w2 + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

const UPSCALE_BELOW = 900;

// Joins strokes whose ends touch (the pieces a junction cluster splits a line
// into), so a letter is one stroke instead of several and the pad's stroke
// budget is not spent on fragments.
function joinTouching(strokes: number[][], radius: number): number[][] {
  const pool = strokes.map((s) => s.slice());
  const r2 = radius * radius;
  const dist2 = (a: number[], ai: number, b: number[], bi: number) =>
    (a[ai] - b[bi]) ** 2 + (a[ai + 1] - b[bi + 1]) ** 2;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < pool.length && !merged; i++) {
      for (let j = i + 1; j < pool.length && !merged; j++) {
        const a = pool[i];
        const b = pool[j];
        const aEnd = a.length - 2;
        const bEnd = b.length - 2;
        let joined: number[] | null = null;
        if (dist2(a, aEnd, b, 0) <= r2) joined = [...a, ...b];
        else if (dist2(a, aEnd, b, bEnd) <= r2) joined = [...a, ...reversePoints(b)];
        else if (dist2(a, 0, b, bEnd) <= r2) joined = [...b, ...a];
        else if (dist2(a, 0, b, 0) <= r2) joined = [...reversePoints(a), ...b];
        if (joined) {
          pool[i] = joined;
          pool.splice(j, 1);
          merged = true;
        }
      }
    }
  }
  return pool;
}

function reversePoints(points: number[]): number[] {
  const out: number[] = [];
  for (let i = points.length - 2; i >= 0; i -= 2) out.push(points[i], points[i + 1]);
  return out;
}

export function traceInk(img: RawImage): TraceResult {
  const origWidth = img.width;
  const origHeight = img.height;
  const empty: TraceResult = { strokes: [], width: origWidth, height: origHeight };
  if (origWidth < 8 || origHeight < 8) return empty;

  let lum = luminance(img);
  let factor = 1;
  if (Math.max(origWidth, origHeight) <= UPSCALE_BELOW) {
    lum = upscale2x(lum, origWidth, origHeight);
    factor = 2;
  }
  const width = origWidth * factor;
  const height = origHeight * factor;
  const threshold = Math.min(otsuThreshold(lum), MAX_INK_THRESHOLD);
  // One pixel border so thinning and walking never index outside the image.
  const w = width + 2;
  const h = height + 2;
  const mask = new Uint8Array(w * h);
  let inkCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (lum[y * width + x] <= threshold) {
        mask[(y + 1) * w + (x + 1)] = 1;
        inkCount++;
      }
    }
  }
  if (inkCount === 0) return empty;
  // A dark screenshot (light writing on a dark background) has the ink as the
  // minority color the other way round: flip it so the writing is the mask.
  if (inkCount > (width * height) / 2) {
    for (let i = 0; i < mask.length; i++) mask[i] = mask[i] ? 0 : 1;
    for (let x = 0; x < w; x++) {
      mask[x] = 0;
      mask[(h - 1) * w + x] = 0;
    }
    for (let y = 0; y < h; y++) {
      mask[y * w] = 0;
      mask[y * w + w - 1] = 0;
    }
  }
  despeckle(mask, w, h);
  thin(mask, w, h);

  const strokes: number[][] = [];
  const skeleton = walkSkeleton(mask, w, h);
  for (const path of skeleton.paths) {
    const isSpur = (path.startKind === 1 && path.endKind >= 3) || (path.endKind === 1 && path.startKind >= 3);
    if (isSpur && path.pixels.length <= MAX_SPUR_LENGTH) continue;
    const points: number[] = [];
    for (const p of path.pixels) {
      const x = p % w;
      points.push(x - 1 + 0.5, (p - x) / w - 1 + 0.5);
    }
    // Snap each end that reaches a junction or line end to that cluster's
    // centre, so crossing strokes meet at one point.
    const startCentre = path.startNode >= 0 ? skeleton.centroidOf(path.startNode) : null;
    const endCentre = path.endNode >= 0 ? skeleton.centroidOf(path.endNode) : null;
    if (startCentre) {
      points[0] = startCentre[0] - 1 + 0.5;
      points[1] = startCentre[1] - 1 + 0.5;
    }
    if (endCentre && path.pixels.length > 1) {
      points[points.length - 2] = endCentre[0] - 1 + 0.5;
      points[points.length - 1] = endCentre[1] - 1 + 0.5;
    }
    if (path.pixels.length === 1) points.push(points[0] + 1, points[1]); // a dot
    const simplified = simplify(points, SIMPLIFY_EPSILON * factor);
    if (simplified.length < 4) continue;
    // Back to the original image's pixel space.
    if (factor !== 1) for (let k = 0; k < simplified.length; k++) simplified[k] /= factor;
    strokes.push(simplified);
  }
  return { strokes: joinTouching(strokes, 2.2), width: origWidth, height: origHeight };
}
