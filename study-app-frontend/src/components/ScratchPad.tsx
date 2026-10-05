import {
  BoxSelect,
  ChevronDown,
  Copy,
  Delete,
  Eraser,
  Hand,
  LassoSelect,
  Maximize2,
  Minimize2,
  PenLine,
  Plus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { scopeKey } from "../lib/api";
import { traceInk } from "../lib/inkTrace";
import { MarkdownContent } from "./MarkdownContent";

// ── Stroke data model ───────────────────────────────────────────────────────
// Strokes live in a FIXED LOGICAL PAPER SPACE (not CSS pixels, not device
// pixels), so a drawing replays identically no matter how the modal is
// resized or which device's screen it is opened on. Points are a flat
// [x0,y0,x1,y1,...] array, not an array of {x,y} objects: measurably smaller
// once JSON-serialized (no repeated "x"/"y" keys), and combined with the RDP
// simplification below (which cuts POINT COUNT, a separate and larger win),
// this matters because the drawing now rides in the DB draft (STEM Scratch
// Pad feature), not just localStorage.
export const SCRATCH_PAD_LOGICAL_WIDTH = 1000;

export type Stroke = {
  points: number[]; // flat [x0,y0,x1,y1,...] in logical paper units
};

export type ScratchPadData = {
  version: 1;
  strokes: Stroke[];
};

export type PaperStyle = "blank" | "lined" | "graph";

// Raised from 400: a traced photo of handwriting is a few hundred strokes.
const MAX_STROKES_PER_QUESTION = 1500;
// Generous on purpose: fast cursive with coalesced stylus samples can run to
// well over a thousand points in a single long stroke, and silently dropping
// the tail of a stroke is what makes writing transcribe as garbled.
const MAX_POINTS_PER_STROKE = 2400;
// Below this, a drawing is treated as empty (a stray dot from a resting palm,
// an accidental tap): no PNG is exported and no OCR call is made. See the
// "no ink, no cost" invariant in the STEM Scratch Pad design doc.
const MIN_INK_BBOX_AREA = 400; // logical units^2, e.g. a 20x20 mark

export function emptyScratchPad(): ScratchPadData {
  return { version: 1, strokes: [] };
}

// A stable empty value for render paths that need a placeholder every render.
// Calling emptyScratchPad() inline in JSX hands the pad a brand new strokes
// array on each parent render, which the pad reads as "the strokes changed
// outside of me" and adopts, wiping work in progress. Never mutate this.
export const EMPTY_SCRATCH_PAD: ScratchPadData = Object.freeze({
  version: 1,
  strokes: Object.freeze([]) as unknown as Stroke[],
}) as ScratchPadData;

export function parseScratchPadJson(raw: string | null | undefined): ScratchPadData {
  if (!raw) return emptyScratchPad();
  try {
    const parsed = JSON.parse(raw) as Partial<ScratchPadData>;
    if (parsed.version === 1 && Array.isArray(parsed.strokes)) {
      return { version: 1, strokes: parsed.strokes };
    }
  } catch {
    /* corrupt or pre-format data: treat as empty rather than throwing */
  }
  return emptyScratchPad();
}

// Ramer-Douglas-Peucker simplification, run on a stroke at pointerup. Cuts
// point count by roughly 60-80% on natural handwriting with no visible
// change, which matters now that strokes are persisted server-side in the
// draft attempt, not just held in memory.
function simplifyStroke(points: number[], epsilon = 1.2): number[] {
  const n = points.length / 2;
  if (n <= 2) return points;
  const pts: [number, number][] = [];
  for (let i = 0; i < points.length; i += 2) pts.push([points[i], points[i + 1]]);

  function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]): number {
    const [x, y] = p;
    const [x1, y1] = a;
    const [x2, y2] = b;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(x - x1, y - y1);
    const t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    return Math.hypot(x - px, y - py);
  }

  function rdp(start: number, end: number, keep: Set<number>) {
    let maxDist = 0;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularDistance(pts[i], pts[start], pts[end]);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    if (maxDist > epsilon && maxIndex !== -1) {
      rdp(start, maxIndex, keep);
      keep.add(maxIndex);
      rdp(maxIndex, end, keep);
    }
  }

  const keep = new Set<number>([0, pts.length - 1]);
  rdp(0, pts.length - 1, keep);
  const sortedIndices = [...keep].sort((a, b) => a - b);
  const out: number[] = [];
  for (const i of sortedIndices) {
    out.push(pts[i][0], pts[i][1]);
  }
  return out;
}

function strokeBounds(strokes: Stroke[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.points.length; i += 2) {
      any = true;
      const x = stroke.points[i];
      const y = stroke.points[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

// True when there is nothing meaningfully drawn: zero strokes, or ink whose
// bounding box is too small to be real work (a stray dot, an accidental
// tap). Checked both here (client) and again server-side (STEM Scratch Pad
// design doc, "no ink, no cost"): the vision model must never be called for
// an unused pad, and this is the cheapest guard in the whole feature.
export function isScratchPadEmpty(data: ScratchPadData): boolean {
  if (data.strokes.length === 0) return true;
  const bounds = strokeBounds(data.strokes);
  if (!bounds) return true;
  const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  return area < MIN_INK_BBOX_AREA;
}

// Renders the drawing onto a fresh offscreen canvas, white background, forced
// near-black ink, cropped to the ink bounding box with padding, scaled so the
// long edge is <=1568px (Claude's standard-tier resolution limit). Never
// touches the on-screen canvas's toDataURL: that canvas has alpha, and PNG
// alpha is composited unpredictably by vision models. Returns null when the
// pad is empty (see isScratchPadEmpty), so a caller never accidentally spends
// an OCR call on nothing.
export function exportScratchPadPng(data: ScratchPadData): string | null {
  if (isScratchPadEmpty(data)) return null;
  const bounds = strokeBounds(data.strokes);
  if (!bounds) return null;

  const padding = 24;
  const cropX = Math.max(0, bounds.minX - padding);
  const cropY = Math.max(0, bounds.minY - padding);
  const cropW = bounds.maxX - bounds.minX + padding * 2;
  const cropH = bounds.maxY - bounds.minY + padding * 2;

  // Strokes are vectors, so rendering the crop LARGER than its logical size is
  // a real resolution gain, not interpolation: it gives the OCR engine more
  // pixels per character. A few lines of work occupy only a few hundred
  // logical units, so without upscaling the image lands far under the engine's
  // budget and small marks (an exponent, a degree sign) transcribe badly.
  // Capped so a tiny crop does not blow up into a needlessly huge payload.
  const MAX_LONG_EDGE = 1568;
  const MAX_UPSCALE = 4;
  const scale = Math.min(MAX_UPSCALE, MAX_LONG_EDGE / Math.max(cropW, cropH));
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  // Forced near-black regardless of the on-screen stroke color: a dark-theme
  // stroke composited onto this white background would otherwise be
  // invisible, producing a confidently blank transcription.
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = Math.max(1.5, 2.5 * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Translate the crop origin so the shared smoothing path can be reused, and
  // the engine reads the same curves the student saw rather than a faceted
  // polyline version of them.
  ctx.translate(-cropX * scale, -cropY * scale);
  for (const stroke of data.strokes) {
    drawSmoothPath(ctx, stroke.points, scale, scale);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const dataUrl = canvas.toDataURL("image/png");
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? null : dataUrl.slice(comma + 1);
}

// ── The canvas itself: pointer capture, dpr, incremental painting ───────────

type CanvasSurfaceProps = {
  strokes: Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
  paperStyle: PaperStyle;
};

// The paper starts about one screen tall and grows downward on request, so a
// long derivation is not capped by the modal's height. Stroke coordinates are
// absolute logical units, so a taller page needs no format change: a drawing
// saved on an extended page reopens on a page auto-sized to fit it.
const MIN_LOGICAL_HEIGHT = 700;
const LOGICAL_HEIGHT_STEP = 500;
const MAX_LOGICAL_HEIGHT = 4200;
// A window wider than the base page shows MORE page instead of a bigger one:
// ink is drawn at no more than this many CSS pixels per logical unit, and the
// page's logical width grows to fill the rest. The pad at full screen is a
// roomier sheet, not a zoomed one.
const INK_SCALE = 0.75;
const MAX_LOGICAL_WIDTH = 5000;
// The draft column holds the strokes as JSON (work_strokes max_length 200_000).
const MAX_STROKES_JSON_CHARS = 180_000;
// Coordinates are kept to a tenth of a logical unit: indistinguishable on
// screen, and about a third the JSON of raw floats.
const COORD_PRECISION = 10;
// A stroke is simplified only to the extent the eye cannot see. The old 1.2
// removed enough points that the saved stroke visibly reshaped the moment the
// pen lifted, most noticeably on a wide pad where one unit is more pixels.
const SIMPLIFY_EPSILON = 0.4;
// The parent (the whole test page) hears about edits this long after the last
// stroke, not after every one: re-rendering it per stroke is what stalled
// writing. The pad flushes on close and when the page is hidden.
const NOTIFY_DELAY_MS = 400;
const SELECT_COLOR = "#2b6fd6";
const SELECT_PAD_PX = 6;
const HANDLE_PX = 5;
const HANDLE_HIT_PX = 16;
const HISTORY_LIMIT = 60;
const DUPLICATE_OFFSET = 24;

// Radius, in logical units, within which the stroke eraser takes a stroke out.
const ERASE_RADIUS = 16;

type Tool = "pen" | "erase" | "select";
type SelectMode = "lasso" | "box";

function ctxOf(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  // desynchronized lets the browser paint the ink layer without waiting for
  // the compositor, which is the largest single cut in pen-to-ink latency.
  // The flag only takes effect on the first getContext call for a canvas.
  return canvas ? canvas.getContext("2d", { desynchronized: true }) : null;
}

function inkStyle(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "#26301f";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  const ctx = ctxOf(canvas);
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
}

function round1(value: number): number {
  return Math.round(value * COORD_PRECISION) / COORD_PRECISION;
}

function roundPoints(points: number[]): number[] {
  return points.map(round1);
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Tested against the stroke's segments rather than only its stored points:
// RDP simplification leaves long straight runs with very sparse points, and a
// point-only test would refuse to erase the middle of them.
function strokeHit(points: number[], x: number, y: number, radius: number): boolean {
  if (points.length < 4) {
    return points.length >= 2 && Math.hypot(points[0] - x, points[1] - y) <= radius;
  }
  for (let i = 0; i + 3 < points.length; i += 2) {
    if (distanceToSegment(x, y, points[i], points[i + 1], points[i + 2], points[i + 3]) <= radius) return true;
  }
  return false;
}

function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const yi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A stroke is picked up when at least half of its points fall inside the
// shape, so a lasso that clips a tail of a long stroke leaves it alone.
function strokesInShape(strokes: Stroke[], mode: SelectMode, shape: number[]): Stroke[] {
  const x0 = shape[0];
  const y0 = shape[1];
  const x1 = shape[shape.length - 2];
  const y1 = shape[shape.length - 1];
  const inside = (x: number, y: number) =>
    mode === "box"
      ? x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1)
      : pointInPolygon(x, y, shape);
  return strokes.filter((stroke) => {
    const n = stroke.points.length / 2;
    let hit = 0;
    for (let i = 0; i < n; i++) if (inside(stroke.points[i * 2], stroke.points[i * 2 + 1])) hit++;
    return n > 0 && hit * 2 >= n;
  });
}

function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  return { points: stroke.points.map((v, i) => round1(v + (i % 2 === 0 ? dx : dy))) };
}

function scaleStroke(stroke: Stroke, ax: number, ay: number, factor: number): Stroke {
  return { points: stroke.points.map((v, i) => round1(i % 2 === 0 ? ax + (v - ax) * factor : ay + (v - ay) * factor)) };
}

// Draws a polyline as quadratic curves through the midpoints of consecutive
// samples. Straight lineTo hops between raw pointer samples are what made
// handwriting look faceted and stiff, most visibly at speed, when the samples
// are furthest apart.
function drawSmoothPath(ctx: CanvasRenderingContext2D, points: number[], scaleX: number, scaleY: number) {
  const n = points.length / 2;
  if (n < 2) return;
  const px = (i: number) => points[i * 2] * scaleX;
  const py = (i: number) => points[i * 2 + 1] * scaleY;
  ctx.beginPath();
  ctx.moveTo(px(0), py(0));
  if (n === 2) {
    ctx.lineTo(px(1), py(1));
  } else {
    for (let i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(px(i), py(i), (px(i) + px(i + 1)) / 2, (py(i) + py(i + 1)) / 2);
    }
    ctx.lineTo(px(n - 1), py(n - 1));
  }
  ctx.stroke();
}

// One pointer gesture. Erasing is modelled as a gesture rather than a mode
// flag so a stylus eraser tip can erase without disturbing whichever tool the
// toolbar has selected. Gestures are tracked per pointer id, because a stylus
// drawing and a palm or finger resting on the glass are two live pointers at
// once and must not interfere with each other.
type Gesture =
  | { kind: "draw"; pointerId: number; points: number[]; predicted: number[] }
  | { kind: "erase"; pointerId: number; snapshot: Stroke[]; remaining: Stroke[] }
  | { kind: "scroll"; pointerId: number; startY: number; startTop: number }
  | { kind: "select"; pointerId: number; mode: SelectMode; points: number[] }
  | { kind: "move"; pointerId: number; startX: number; startY: number; base: Stroke[]; rest: Stroke[]; dx: number; dy: number }
  | { kind: "scale"; pointerId: number; ax: number; ay: number; startDist: number; base: Stroke[]; rest: Stroke[]; factor: number };

function CanvasSurface({ strokes, onStrokesChange, paperStyle }: CanvasSurfaceProps) {
  // Three stacked canvases. The static one holds committed strokes and gains
  // each new stroke incrementally; the live one holds just the stroke being
  // drawn; the overlay holds selection chrome and the preview of a selection
  // being moved or resized. Repainting every committed stroke after every
  // stroke is what made writing stall once a page had real work on it.
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const gesturesRef = useRef<Map<number, Gesture>>(new Map());
  const rafPendingRef = useRef(false);
  // The page's logical size and the CSS pixels per logical unit, set by
  // applySize. Everything that maps pointer to page reads this, so a window
  // resize never has to re-render React.
  const dimsRef = useRef({ w: SCRATCH_PAD_LOGICAL_WIDTH, h: MIN_LOGICAL_HEIGHT, scale: 1 });
  // What the static canvas currently shows, so a single added stroke is drawn
  // alone instead of repainting the page.
  const paintedRef = useRef<{ strokes: Stroke[]; key: string } | null>(null);

  const [allowFingerDraw, setAllowFingerDraw] = useState<boolean>(() => {
    const saved = localStorage.getItem(scopeKey("nosey_scratchpad_finger"));
    return saved === null ? true : saved === "1";
  });
  const [tool, setTool] = useState<Tool>("pen");
  const [selectMode, setSelectMode] = useState<SelectMode>("lasso");
  const [selected, setSelected] = useState<Stroke[]>([]);
  const selectedRef = useRef<Stroke[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<Stroke[][]>([]);

  // The canvas owns what it renders. Routing every stroke through the parent
  // first meant a finished stroke could not appear until the whole test page
  // re-rendered, which is why ink showed up seconds late.
  const [localStrokes, setLocalStrokes] = useState<Stroke[]>(strokes);
  const localStrokesRef = useRef<Stroke[]>(strokes);
  // Arrays this component has handed to the parent. A prop that matches one is
  // an echo of our own edit, not news from outside: adopting a slightly older
  // echo would wipe the newest stroke.
  const emittedRef = useRef<Stroke[][]>([strokes]);
  const onChangeRef = useRef(onStrokesChange);
  const pendingRef = useRef<Stroke[] | null>(null);
  const notifyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onChangeRef.current = onStrokesChange;
  }, [onStrokesChange]);

  // Adopt strokes that came from outside (a draft loading, the parent
  // resetting) while ignoring the echo of what this component just emitted.
  useEffect(() => {
    if (emittedRef.current.includes(strokes)) return;
    emittedRef.current = [strokes];
    localStrokesRef.current = strokes;
    setLocalStrokes(strokes);
    selectedRef.current = [];
    setSelected([]);
  }, [strokes]);

  // Sized on open to fit whatever was drawn before, so reopening a drawing
  // made on an extended page does not clip the work below the default height.
  const [pageHeight, setPageHeight] = useState(() => {
    const bounds = strokeBounds(strokes);
    if (!bounds) return MIN_LOGICAL_HEIGHT;
    return Math.min(
      MAX_LOGICAL_HEIGHT,
      Math.max(MIN_LOGICAL_HEIGHT, Math.ceil((bounds.maxY + 120) / LOGICAL_HEIGHT_STEP) * LOGICAL_HEIGHT_STEP),
    );
  });

  const flushNotify = useCallback(() => {
    if (notifyTimerRef.current != null) {
      window.clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      onChangeRef.current(pending);
    }
  }, []);

  const commitStrokes = useCallback(
    (next: Stroke[]) => {
      localStrokesRef.current = next;
      emittedRef.current = [...emittedRef.current.slice(-7), next];
      setLocalStrokes(next);
      // Tell the parent once the pen has been still for a moment. The parent
      // update re-renders the test page and schedules a draft save; doing that
      // per stroke is what froze the pad between strokes.
      pendingRef.current = next;
      if (notifyTimerRef.current != null) window.clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = window.setTimeout(flushNotify, NOTIFY_DELAY_MS);
    },
    [flushNotify],
  );

  useEffect(() => {
    const flushIfHidden = () => {
      if (document.visibilityState === "hidden") flushNotify();
    };
    window.addEventListener("pagehide", flushNotify);
    document.addEventListener("visibilitychange", flushIfHidden);
    return () => {
      window.removeEventListener("pagehide", flushNotify);
      document.removeEventListener("visibilitychange", flushIfHidden);
      flushNotify();
    };
  }, [flushNotify]);

  const pushHistory = useCallback((snapshot: Stroke[]) => {
    setHistory((h) => [...h, snapshot].slice(-HISTORY_LIMIT));
  }, []);

  const setSelection = useCallback((next: Stroke[]) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  const ensureHeight = useCallback((maxY: number) => {
    setPageHeight((h) =>
      Math.min(MAX_LOGICAL_HEIGHT, Math.max(h, Math.ceil((maxY + 120) / LOGICAL_HEIGHT_STEP) * LOGICAL_HEIGHT_STEP)),
    );
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function toLogicalIn(rect: DOMRect, clientX: number, clientY: number): [number, number] {
    const { w, h } = dimsRef.current;
    return [(clientX - rect.left) * (w / rect.width), (clientY - rect.top) * (h / rect.height)];
  }

  const toLogical = useCallback((clientX: number, clientY: number): [number, number] => {
    const canvas = liveCanvasRef.current;
    if (!canvas) return [0, 0];
    // The canvas element's own rect, not the container's: the canvas may
    // stand taller than the container and scroll inside it.
    return toLogicalIn(canvas.getBoundingClientRect(), clientX, clientY);
  }, []);

  // Paints committed strokes. With no override and exactly one new stroke
  // since the last paint, only that stroke is drawn. `override` lets an erase
  // or move drag preview its result before it is committed.
  const paintStatic = useCallback((override?: Stroke[]) => {
    const canvas = staticCanvasRef.current;
    const ctx = ctxOf(canvas);
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h, scale } = dimsRef.current;
    const list = override ?? localStrokesRef.current;
    const key = `${w}x${h}x${dpr}x${canvas.width}`;
    const prev = paintedRef.current;
    inkStyle(ctx);
    if (
      !override &&
      prev &&
      prev.key === key &&
      list.length === prev.strokes.length + 1 &&
      prev.strokes.every((stroke, i) => stroke === list[i])
    ) {
      drawSmoothPath(ctx, list[list.length - 1].points, scale, scale);
    } else {
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      for (const stroke of list) drawSmoothPath(ctx, stroke.points, scale, scale);
    }
    paintedRef.current = override ? null : { strokes: list, key };
  }, []);

  function clearLive() {
    clearCanvas(liveCanvasRef.current);
  }

  // Redraws the in-progress strokes whole, once per frame. One stroke is at
  // most a couple of thousand points, so this is cheap, and it lets the line
  // run all the way to the pen tip (plus the browser's predicted next
  // samples) instead of stopping at the last midpoint behind it.
  function renderLive() {
    const canvas = liveCanvasRef.current;
    const ctx = ctxOf(canvas);
    if (!canvas || !ctx) return;
    clearCanvas(canvas);
    inkStyle(ctx);
    const { scale } = dimsRef.current;
    for (const gesture of gesturesRef.current.values()) {
      if (gesture.kind !== "draw") continue;
      drawSmoothPath(ctx, gesture.predicted.length ? gesture.points.concat(gesture.predicted) : gesture.points, scale, scale);
    }
  }

  function drawOverlay() {
    const canvas = overlayCanvasRef.current;
    const ctx = ctxOf(canvas);
    if (!canvas || !ctx) return;
    clearCanvas(canvas);
    const { scale } = dimsRef.current;
    let active: Gesture | undefined;
    for (const gesture of gesturesRef.current.values()) {
      if (gesture.kind === "move" || gesture.kind === "scale" || gesture.kind === "select") active = gesture;
    }
    let shown = selectedRef.current;
    if (active?.kind === "move") shown = active.base.map((s) => translateStroke(s, active.dx, active.dy));
    else if (active?.kind === "scale") shown = active.base.map((s) => scaleStroke(s, active.ax, active.ay, active.factor));

    if (shown.length) {
      ctx.strokeStyle = SELECT_COLOR;
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      for (const stroke of shown) drawSmoothPath(ctx, stroke.points, scale, scale);
      const b = strokeBounds(shown);
      if (b) {
        const pad = SELECT_PAD_PX / scale;
        const x = (b.minX - pad) * scale;
        const y = (b.minY - pad) * scale;
        const w = (b.maxX - b.minX + pad * 2) * scale;
        const h = (b.maxY - b.minY + pad * 2) * scale;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        for (const [cx, cy] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) {
          ctx.beginPath();
          ctx.rect(cx - HANDLE_PX, cy - HANDLE_PX, HANDLE_PX * 2, HANDLE_PX * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    if (active?.kind === "select" && active.points.length >= 4) {
      ctx.strokeStyle = SELECT_COLOR;
      ctx.fillStyle = "rgba(43, 111, 214, 0.08)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      const p = active.points;
      ctx.beginPath();
      if (active.mode === "box") {
        const x0 = p[0] * scale;
        const y0 = p[1] * scale;
        ctx.rect(x0, y0, p[p.length - 2] * scale - x0, p[p.length - 1] * scale - y0);
      } else {
        ctx.moveTo(p[0] * scale, p[1] * scale);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * scale, p[i + 1] * scale);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Pointer events fire faster than the display refreshes, so the live and
  // overlay layers are redrawn once per frame rather than once per event.
  function scheduleFrame() {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      renderLive();
      drawOverlay();
    });
  }

  // Any assignment to canvas.width/height clears the canvas, so sizing always
  // means: resize the backing stores, re-apply the dpr transform, full replay.
  // The window's width sets the page's logical width (see INK_SCALE).
  const applySize = useCallback(() => {
    const container = containerRef.current;
    const page = pageRef.current;
    const canvases = [staticCanvasRef.current, overlayCanvasRef.current, liveCanvasRef.current];
    if (!container || !page || canvases.some((c) => !c)) return;
    const cssWidth = container.clientWidth;
    const cssAvailHeight = container.clientHeight;
    if (cssWidth <= 0) return;
    const bounds = strokeBounds(localStrokesRef.current);
    const needW = bounds ? Math.ceil((bounds.maxX + 40) / 50) * 50 : 0;
    const logicalW = Math.min(
      MAX_LOGICAL_WIDTH,
      Math.max(SCRATCH_PAD_LOGICAL_WIDTH, needW, Math.ceil(cssWidth / INK_SCALE / 50) * 50),
    );
    const scale = cssWidth / logicalW;
    // Never shorter than the window: a tall window gets a taller sheet, so
    // there is no dead strip under the paper.
    const logicalH = Math.max(pageHeight, Math.floor(cssAvailHeight / scale));
    const cssHeight = logicalH * scale;
    dimsRef.current = { w: logicalW, h: logicalH, scale };
    const dpr = window.devicePixelRatio || 1;
    page.style.height = `${cssHeight}px`;
    for (const canvas of canvases as HTMLCanvasElement[]) {
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const ctx = ctxOf(canvas);
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    paintedRef.current = null;
    paintStatic();
    renderLive();
    drawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageHeight, paintStatic]);

  const applySizeRef = useRef(applySize);
  useEffect(() => {
    applySizeRef.current = applySize;
  }, [applySize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let timer: number | null = null;
    const observer = new ResizeObserver(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => applySizeRef.current(), 100);
    });
    observer.observe(container);
    applySizeRef.current();
    return () => {
      observer.disconnect();
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  // Growing the page changes the backing stores, same treatment as a resize.
  useEffect(() => {
    applySizeRef.current();
  }, [pageHeight]);

  // Ink that reaches past the page's right edge (a drawing from a wider
  // window) widens the logical page so it is not cropped on a narrow one.
  const rightEdge = useMemo(() => strokeBounds(localStrokes)?.maxX ?? 0, [localStrokes]);
  useEffect(() => {
    if (rightEdge + 40 > dimsRef.current.w) applySizeRef.current();
  }, [rightEdge]);

  // useLayoutEffect, not useEffect: a finished stroke is cleared from the live
  // layer synchronously, so the static layer has to pick it up before the
  // browser paints. On useEffect the stroke would blink out for one frame.
  useLayoutEffect(() => {
    paintStatic();
  }, [localStrokes, paintStatic]);

  useLayoutEffect(() => {
    drawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, localStrokes]);

  function eraseAt(pointerId: number, clientX: number, clientY: number) {
    const gesture = gesturesRef.current.get(pointerId);
    if (!gesture || gesture.kind !== "erase") return;
    const [x, y] = toLogical(clientX, clientY);
    const kept = gesture.remaining.filter((stroke) => !strokeHit(stroke.points, x, y, ERASE_RADIUS));
    if (kept.length !== gesture.remaining.length) {
      gesture.remaining = kept;
      paintStatic(kept);
    }
  }

  // ── Selection actions ───────────────────────────────────────────────────

  function deleteSelection() {
    const sel = selectedRef.current;
    if (sel.length === 0) return;
    const prev = localStrokesRef.current;
    pushHistory(prev);
    commitStrokes(prev.filter((s) => !sel.includes(s)));
    setSelection([]);
  }

  function duplicateSelection() {
    const sel = selectedRef.current;
    if (sel.length === 0) return;
    const prev = localStrokesRef.current;
    if (prev.length + sel.length > MAX_STROKES_PER_QUESTION) {
      setNotice("The page is full. Erase something before duplicating.");
      return;
    }
    const copies = sel.map((s) => translateStroke(s, DUPLICATE_OFFSET, DUPLICATE_OFFSET));
    const b = strokeBounds(copies);
    if (b) ensureHeight(b.maxY);
    pushHistory(prev);
    commitStrokes([...prev, ...copies]);
    setSelection(copies);
  }

  // Closes out one pointer's gesture, committing whatever it produced. Used
  // both on a normal pointerup and to recover a gesture whose pointerup the
  // device never delivered (an occasional real failure for stylus input).
  function finalizeGesture(pointerId: number) {
    const gesture = gesturesRef.current.get(pointerId);
    if (!gesture) return;
    gesturesRef.current.delete(pointerId);
    const prev = localStrokesRef.current;
    const { w, scale } = dimsRef.current;

    if (gesture.kind === "scroll") return;

    if (gesture.kind === "erase") {
      if (gesture.remaining.length !== gesture.snapshot.length) {
        pushHistory(gesture.snapshot);
        commitStrokes(gesture.remaining);
        setSelection([]);
      }
      return;
    }

    if (gesture.kind === "move" || gesture.kind === "scale") {
      const moved =
        gesture.kind === "move"
          ? Math.abs(gesture.dx) + Math.abs(gesture.dy) >= 1
          : Math.abs(gesture.factor - 1) > 0.005;
      if (!moved) {
        paintStatic();
        drawOverlay();
        return;
      }
      const clampX = (v: number) => Math.max(0, Math.min(w, v));
      const transformed = gesture.base.map((s) => {
        const t =
          gesture.kind === "move"
            ? translateStroke(s, gesture.dx, gesture.dy)
            : scaleStroke(s, gesture.ax, gesture.ay, gesture.factor);
        return { points: t.points.map((v, i) => (i % 2 === 0 ? clampX(v) : Math.max(0, v))) };
      });
      const b = strokeBounds(transformed);
      if (b) ensureHeight(b.maxY);
      pushHistory(prev);
      commitStrokes(prev.map((s) => {
        const i = gesture.base.indexOf(s);
        return i >= 0 ? transformed[i] : s;
      }));
      setSelection(transformed);
      return;
    }

    if (gesture.kind === "select") {
      const p = gesture.points;
      // The extent of what was drawn, not first-to-last distance: a closed
      // lasso ends where it began and would otherwise read as a tap.
      let extent = 0;
      for (let i = 2; i < p.length; i += 2) extent = Math.max(extent, Math.hypot(p[i] - p[0], p[i + 1] - p[1]));
      let picked: Stroke[] = [];
      if (extent * scale < 6) {
        // A tap: pick the stroke under the finger, if any.
        for (let i = prev.length - 1; i >= 0; i--) {
          if (strokeHit(prev[i].points, p[0], p[1], 10 / scale)) {
            picked = [prev[i]];
            break;
          }
        }
      } else {
        picked = strokesInShape(prev, gesture.mode, p);
      }
      setSelection(picked);
      drawOverlay();
      return;
    }

    if (gesture.points.length < 4) {
      clearLive();
      return; // a tap, not a stroke
    }
    const simplified = roundPoints(simplifyStroke(gesture.points, SIMPLIFY_EPSILON));
    const next = [...prev, { points: simplified }].slice(-MAX_STROKES_PER_QUESTION);
    pushHistory(prev);
    // The static layer picks this stroke up on the very next paint, which
    // React commits synchronously from local state, so clearing the live layer
    // here does not leave a visible gap.
    clearLive();
    commitStrokes(next);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    // Only ever recovers THIS pointer id. A different pointer going down is
    // not evidence that this one ended: a stylus drawing while a palm rests on
    // the glass is exactly that case, and treating it as an ended gesture is
    // what cut strokes short.
    if (gesturesRef.current.has(e.pointerId)) finalizeGesture(e.pointerId);

    if (e.pointerType === "touch" && !allowFingerDraw) {
      // Finger still drives the page, it just does not mark it: drag to
      // scroll, handled here rather than by the browser. touch-action stays
      // "none" so the browser never runs its own multi-touch gesture
      // arbitration, which is what fired pointercancel at an in-progress
      // stylus stroke the moment a second finger landed, discarding it.
      const canvas = liveCanvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.setPointerCapture(e.pointerId);
      gesturesRef.current.set(e.pointerId, {
        kind: "scroll",
        pointerId: e.pointerId,
        startY: e.clientY,
        startTop: container.scrollTop,
      });
      return;
    }

    // A stylus eraser tip is only reliably signalled by `button === 5` on the
    // exact event where it made contact. The `buttons` bitmask's eraser bit
    // (0x20) is a live, driver-reported flag, and several Windows Ink /
    // Chromium digitizer combinations leave it spuriously set after the
    // eraser end was last used, turning the NEXT ordinary tip-down into a
    // silent no-op erase: the pen moves, nothing draws, until a full clean
    // erase gesture resets the stuck state. `button` alone does not have that
    // failure mode, so it is the only signal trusted here.
    const stylusEraser = e.pointerType === "pen" && e.button === 5;
    const erasing = tool === "erase" || stylusEraser;

    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const list = localStrokesRef.current;

    if (erasing) {
      gesturesRef.current.set(e.pointerId, {
        kind: "erase",
        pointerId: e.pointerId,
        snapshot: list,
        remaining: list,
      });
      eraseAt(e.pointerId, e.clientX, e.clientY);
      return;
    }

    if (tool === "select") {
      const [x, y] = toLogical(e.clientX, e.clientY);
      const { scale } = dimsRef.current;
      const sel = selectedRef.current;
      const b = sel.length ? strokeBounds(sel) : null;
      if (b) {
        const pad = SELECT_PAD_PX / scale;
        const corners: [number, number][] = [
          [b.minX - pad, b.minY - pad],
          [b.maxX + pad, b.minY - pad],
          [b.maxX + pad, b.maxY + pad],
          [b.minX - pad, b.maxY + pad],
        ];
        const hit = corners.findIndex(([cx, cy]) => Math.hypot(cx - x, cy - y) <= HANDLE_HIT_PX / scale);
        const rest = list.filter((s) => !sel.includes(s));
        if (hit >= 0) {
          const [ax, ay] = corners[(hit + 2) % 4];
          const startDist = Math.hypot(corners[hit][0] - ax, corners[hit][1] - ay) || 1;
          gesturesRef.current.set(e.pointerId, {
            kind: "scale", pointerId: e.pointerId, ax, ay, startDist, base: sel, rest, factor: 1,
          });
          paintStatic(rest);
          drawOverlay();
          return;
        }
        if (x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad) {
          gesturesRef.current.set(e.pointerId, {
            kind: "move", pointerId: e.pointerId, startX: x, startY: y, base: sel, rest, dx: 0, dy: 0,
          });
          paintStatic(rest);
          drawOverlay();
          return;
        }
      }
      setSelection([]);
      gesturesRef.current.set(e.pointerId, { kind: "select", pointerId: e.pointerId, mode: selectMode, points: [x, y] });
      return;
    }

    clearLive();
    const [x, y] = toLogical(e.clientX, e.clientY);
    gesturesRef.current.set(e.pointerId, { kind: "draw", pointerId: e.pointerId, points: [x, y], predicted: [] });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = gesturesRef.current.get(e.pointerId);
    if (!gesture) return;

    if (gesture.kind === "scroll") {
      const container = containerRef.current;
      if (container) container.scrollTop = gesture.startTop + (gesture.startY - e.clientY);
      return;
    }

    if (gesture.kind === "erase") {
      eraseAt(e.pointerId, e.clientX, e.clientY);
      return;
    }

    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (gesture.kind === "move") {
      const [x, y] = toLogicalIn(rect, e.clientX, e.clientY);
      const b = strokeBounds(gesture.base);
      const { w } = dimsRef.current;
      let dx = x - gesture.startX;
      let dy = y - gesture.startY;
      if (b) {
        dx = Math.max(-b.minX, Math.min(w - b.maxX, dx));
        dy = Math.max(-b.minY, dy);
      }
      gesture.dx = dx;
      gesture.dy = dy;
      scheduleFrame();
      return;
    }

    if (gesture.kind === "scale") {
      const [x, y] = toLogicalIn(rect, e.clientX, e.clientY);
      gesture.factor = Math.max(0.1, Math.min(10, Math.hypot(x - gesture.ax, y - gesture.ay) / gesture.startDist));
      scheduleFrame();
      return;
    }

    // getCoalescedEvents returns every sample the browser batched since the
    // last frame. Keeping them is what stops fast writing from coming out
    // sparse and angular, which then transcribes badly.
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];

    if (gesture.kind === "select") {
      const [x, y] = toLogicalIn(rect, e.clientX, e.clientY);
      if (gesture.mode === "box") {
        gesture.points = [gesture.points[0], gesture.points[1], x, y];
      } else {
        for (const evt of events.length ? events : [native]) {
          const [lx, ly] = toLogicalIn(rect, evt.clientX, evt.clientY);
          gesture.points.push(lx, ly);
        }
      }
      scheduleFrame();
      return;
    }

    for (const evt of events.length ? events : [native]) {
      if (gesture.points.length >= MAX_POINTS_PER_STROKE * 2) break;
      const [x, y] = toLogicalIn(rect, evt.clientX, evt.clientY);
      gesture.points.push(x, y);
    }
    // Where the pen is about to be, as predicted by the browser. Drawn for this
    // frame only and never stored, so a wrong guess costs nothing.
    gesture.predicted = [];
    if (typeof native.getPredictedEvents === "function") {
      for (const evt of native.getPredictedEvents().slice(0, 2)) {
        const [x, y] = toLogicalIn(rect, evt.clientX, evt.clientY);
        gesture.predicted.push(x, y);
      }
    }
    scheduleFrame();
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    finalizeGesture(e.pointerId);
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = gesturesRef.current.get(e.pointerId);
    if (!gesture) return;
    gesturesRef.current.delete(e.pointerId);
    // An abandoned erase, move or resize has been previewing its result on the
    // static layer without committing it, so the real strokes are put back.
    if (gesture.kind === "erase" || gesture.kind === "move" || gesture.kind === "scale") paintStatic();
    else if (gesture.kind === "draw") clearLive();
    drawOverlay();
  }

  function undo() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    commitStrokes(prev);
    setSelection([]);
  }

  function clearAll() {
    if (localStrokesRef.current.length === 0) return;
    pushHistory(localStrokesRef.current);
    commitStrokes([]);
    setSelection([]);
  }

  function chooseTool(next: Tool, mode?: SelectMode) {
    if (mode) setSelectMode(mode);
    setTool(next);
    if (next !== "select") setSelection([]);
  }

  function toggleFingerDraw() {
    setAllowFingerDraw((v) => {
      const next = !v;
      localStorage.setItem(scopeKey("nosey_scratchpad_finger"), next ? "1" : "0");
      return next;
    });
  }

  function addSpace() {
    setPageHeight((h) => Math.min(MAX_LOGICAL_HEIGHT, h + LOGICAL_HEIGHT_STEP));
    // Two frames: one for React to commit the taller page, one for layout to
    // settle before scrolling down to the new space.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }),
    );
  }

  // Pasting a picture of handwriting traces it into pen strokes, below
  // whatever is already on the page (see lib/inkTrace.ts).
  async function importImage(file: Blob) {
    setNotice("Tracing your image...");
    try {
      const bitmap = await createImageBitmap(file);
      const down = Math.min(1, 1100 / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * down));
      const h = Math.max(1, Math.round(bitmap.height * down));
      const surface = document.createElement("canvas");
      surface.width = w;
      surface.height = h;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const image = ctx.getImageData(0, 0, w, h);
      // Let the notice paint before the tracer holds the thread.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const traced = traceInk({ data: image.data, width: w, height: h });
      if (traced.strokes.length === 0) {
        setNotice("Couldn't find any writing in that image.");
        return;
      }
      const prev = localStrokesRef.current;
      const { w: pageW } = dimsRef.current;
      const startY = (strokeBounds(prev)?.maxY ?? 0) + 40;
      const fit = Math.min(2, ((pageW - 80) * 0.6) / traced.width, (MAX_LOGICAL_HEIGHT - 120 - startY) / traced.height);
      if (fit < 0.25) {
        setNotice("There isn't enough room left on the page for that image.");
        return;
      }
      const imported = traced.strokes.map((points) => ({
        points: points.map((v, i) => round1(i % 2 === 0 ? 40 + v * fit : startY + v * fit)),
      }));
      const next = [...prev, ...imported];
      if (next.length > MAX_STROKES_PER_QUESTION || JSON.stringify({ version: 1, strokes: next }).length > MAX_STROKES_JSON_CHARS) {
        setNotice("That image is too detailed to add. Crop it to the part you need.");
        return;
      }
      ensureHeight(startY + traced.height * fit);
      pushHistory(prev);
      commitStrokes(next);
      // Straight into select mode, so the new ink can be dragged into place or
      // resized right away.
      setTool("select");
      setSelection(imported);
      setNotice("Added your image as ink. Drag it into place or resize it with the corners.");
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const container = containerRef.current;
          if (container) container.scrollTo({ top: Math.max(0, (startY - 40) * dimsRef.current.scale), behavior: "smooth" });
        }),
      );
    } catch {
      setNotice("Couldn't read that image.");
    }
  }

  // Window-level handlers need the latest closures but are attached once.
  const actionsRef = useRef({ deleteSelection, undo, importImage, setSelection });
  actionsRef.current = { deleteSelection, undo, importImage, setSelection };

  useEffect(() => {
    const typingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    function onKey(e: KeyboardEvent) {
      if (typingTarget(e.target)) return;
      const hasSelection = selectedRef.current.length > 0;
      if ((e.key === "Delete" || e.key === "Backspace") && hasSelection) {
        e.preventDefault();
        actionsRef.current.deleteSelection();
      } else if (e.key === "Escape" && hasSelection) {
        // Clears the selection without also closing the whole pad.
        e.stopImmediatePropagation();
        actionsRef.current.setSelection([]);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        actionsRef.current.undo();
      }
    }
    function onPaste(e: ClipboardEvent) {
      if (typingTarget(e.target)) return;
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        void actionsRef.current.importImage(file);
        return;
      }
    }
    // Capture phase, so Escape can be claimed before the modal's own handler.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  const paperClass =
    paperStyle === "lined" ? "scratchpad-paper-lined" : paperStyle === "graph" ? "scratchpad-paper-graph" : "scratchpad-paper-blank";
  const atMaxHeight = pageHeight >= MAX_LOGICAL_HEIGHT;
  const hasSelection = selected.length > 0;

  return (
    <div className="scratchpad-canvas-wrap">
      <div className="scratchpad-canvas-toolbar">
        <button type="button" className="scratchpad-tool-btn" onClick={undo} disabled={history.length === 0} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className={`scratchpad-tool-btn${tool === "erase" ? " is-active" : ""}`}
          onClick={() => chooseTool(tool === "erase" ? "pen" : "erase")}
          aria-pressed={tool === "erase"}
          aria-label="Erase individual strokes"
          title="Erase individual strokes"
        >
          <Eraser size={16} />
        </button>
        <button
          type="button"
          className={`scratchpad-tool-btn${tool === "select" && selectMode === "lasso" ? " is-active" : ""}`}
          onClick={() => chooseTool(tool === "select" && selectMode === "lasso" ? "pen" : "select", "lasso")}
          aria-pressed={tool === "select" && selectMode === "lasso"}
          aria-label="Select freehand"
          title="Select freehand: draw around the writing"
        >
          <LassoSelect size={16} />
        </button>
        <button
          type="button"
          className={`scratchpad-tool-btn${tool === "select" && selectMode === "box" ? " is-active" : ""}`}
          onClick={() => chooseTool(tool === "select" && selectMode === "box" ? "pen" : "select", "box")}
          aria-pressed={tool === "select" && selectMode === "box"}
          aria-label="Select a box"
          title="Select a box: drag a rectangle"
        >
          <BoxSelect size={16} />
        </button>
        {hasSelection ? (
          <>
            <button type="button" className="scratchpad-tool-btn" onClick={duplicateSelection} aria-label="Duplicate selection" title="Duplicate">
              <Copy size={16} />
            </button>
            <button type="button" className="scratchpad-tool-btn" onClick={deleteSelection} aria-label="Delete selection" title="Delete selection (Del)">
              <Delete size={16} />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="scratchpad-tool-btn"
          onClick={clearAll}
          disabled={localStrokes.length === 0}
          aria-label="Clear the page"
          title="Clear the page"
        >
          <Trash2 size={16} />
        </button>
        <button
          type="button"
          className={`scratchpad-finger-toggle${allowFingerDraw ? " is-active" : ""}`}
          onClick={toggleFingerDraw}
          aria-pressed={allowFingerDraw}
          title={allowFingerDraw ? "Finger draws on the page" : "Finger scrolls the page, only a stylus draws"}
        >
          <Hand size={14} />
          {allowFingerDraw ? "Draw with finger" : "Finger scrolls"}
        </button>
      </div>
      {notice ? (
        <p className="scratchpad-notice" role="status">
          {notice}
        </p>
      ) : null}
      <div ref={containerRef} className={`scratchpad-canvas-container ${paperClass}`}>
        <div ref={pageRef} className="scratchpad-page">
          <canvas ref={staticCanvasRef} className="scratchpad-canvas scratchpad-canvas--static" aria-hidden="true" />
          <canvas ref={overlayCanvasRef} className="scratchpad-canvas scratchpad-canvas--overlay" aria-hidden="true" />
          <canvas
            ref={liveCanvasRef}
            className={`scratchpad-canvas scratchpad-canvas--live${tool === "erase" ? " is-erasing" : ""}${
              tool === "select" ? " is-selecting" : ""
            }${allowFingerDraw ? "" : " allows-scroll"}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerUp}
          />
        </div>
      </div>
      <button type="button" className="scratchpad-extend-btn" onClick={addSpace} disabled={atMaxHeight}>
        <Plus size={13} />
        {atMaxHeight ? "Page is at its full length" : "Add more space"}
      </button>
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────────

type ScratchPadModalProps = {
  questionText: string;
  data: ScratchPadData;
  onChange: (data: ScratchPadData) => void;
  paperStyle: PaperStyle;
  onPaperStyleChange: (style: PaperStyle) => void;
  onClose: () => void;
};

type SizeState = "comfortable" | "large" | "full";

export function ScratchPadModal({
  questionText,
  data,
  onChange,
  paperStyle,
  onPaperStyleChange,
  onClose,
}: ScratchPadModalProps) {
  const [size, setSize] = useState<SizeState>(
    () => (localStorage.getItem(scopeKey("nosey_scratchpad_size")) as SizeState | null) ?? "comfortable",
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const [customSize, setCustomSize] = useState<{ w: number; h: number } | null>(null);
  // The question runs through KaTeX, which is not cheap. Without this it would
  // re-typeset on every stroke, since a stroke updates the parent's state.
  const questionNode = useMemo(() => <MarkdownContent content={questionText} />, [questionText]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // Body scroll lock while the modal is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  function changeSize(next: SizeState) {
    setSize(next);
    setCustomSize(null);
    localStorage.setItem(scopeKey("nosey_scratchpad_size"), next);
  }

  // Pointer-driven drag-resize handle, so it works with a stylus, not just a
  // mouse (CSS `resize` needs a mouse-drag on a corner grip and does nothing
  // on iPadOS, which is this feature's primary audience).
  function handleResizeStart(e: React.PointerEvent) {
    const card = cardRef.current;
    if (!card) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const rect = card.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height };
  }
  function handleResizeMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const w = Math.max(360, drag.startW + (e.clientX - drag.startX));
    const h = Math.max(280, drag.startH + (e.clientY - drag.startY));
    setCustomSize({ w, h });
  }
  function handleResizeEnd() {
    dragRef.current = null;
  }

  const sizeStyle = customSize ? { width: `${customSize.w}px`, height: `${customSize.h}px` } : undefined;
  const sizeClass = customSize ? "" : `scratchpad-modal--${size}`;

  return (
    <div className="modal-backdrop scratchpad-backdrop" onMouseDown={onClose}>
      <div
        ref={cardRef}
        className={`modal-card scratchpad-modal ${sizeClass}`}
        style={sizeStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Scratch pad"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scratchpad-header">
          <div className="scratchpad-header-main">
            <span className="eyebrow">
              <PenLine size={13} /> Scratch pad
            </span>
            <div className="scratchpad-question-text">
              {questionNode}
            </div>
          </div>
          <div className="scratchpad-header-actions">
            <div className="scratchpad-size-buttons" role="group" aria-label="Scratch pad size">
              <button
                type="button"
                className={size === "comfortable" && !customSize ? "is-active" : ""}
                onClick={() => changeSize("comfortable")}
                aria-label="Comfortable size"
                title="Comfortable"
              >
                <Minimize2 size={14} />
              </button>
              <button
                type="button"
                className={size === "large" && !customSize ? "is-active" : ""}
                onClick={() => changeSize("large")}
                aria-label="Large size"
                title="Large"
              >
                <Maximize2 size={14} />
              </button>
              <button
                type="button"
                className={size === "full" && !customSize ? "is-active" : ""}
                onClick={() => changeSize("full")}
                aria-label="Full screen"
                title="Full screen"
              >
                <ChevronDown size={14} style={{ transform: "rotate(45deg)" }} />
              </button>
            </div>
            <button type="button" className="scratchpad-minimize" onClick={onClose} aria-label="Minimize scratch pad">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="scratchpad-paper-picker" role="group" aria-label="Paper style">
          {(["blank", "lined", "graph"] as PaperStyle[]).map((style) => (
            <button
              key={style}
              type="button"
              className={paperStyle === style ? "is-active" : ""}
              onClick={() => onPaperStyleChange(style)}
            >
              {style === "blank" ? "Blank" : style === "lined" ? "Lined" : "Graph"}
            </button>
          ))}
        </div>

        <CanvasSurface
          strokes={data.strokes}
          onStrokesChange={(strokes) => onChange({ version: 1, strokes })}
          paperStyle={paperStyle}
        />

        <div
          className="scratchpad-resize-handle"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// ── Trigger button, shown inline in the question card ───────────────────────

type ScratchPadTriggerProps = {
  questionText: string;
  data: ScratchPadData;
  onChange: (data: ScratchPadData) => void;
  paperStyle: PaperStyle;
  onPaperStyleChange: (style: PaperStyle) => void;
};

export function ScratchPadTrigger({ questionText, data, onChange, paperStyle, onPaperStyleChange }: ScratchPadTriggerProps) {
  const [open, setOpen] = useState(false);
  const hasWork = !isScratchPadEmpty(data);

  return (
    <>
      <button type="button" className="scratchpad-open-btn" onClick={() => setOpen(true)}>
        <PenLine size={14} />
        {hasWork ? "Continue your scratch work" : "Show your work"}
      </button>
      {open ? (
        <ScratchPadModal
          questionText={questionText}
          data={data}
          onChange={onChange}
          paperStyle={paperStyle}
          onPaperStyleChange={onPaperStyleChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
