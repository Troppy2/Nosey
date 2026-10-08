import {
  BoxSelect,
  ChevronDown,
  Clipboard,
  ClipboardPaste,
  Copy,
  Delete,
  Eraser,
  Hand,
  Highlighter,
  ImageDown,
  LassoSelect,
  Maximize2,
  Minimize2,
  PanelTopClose,
  PanelTopOpen,
  PenLine,
  Plus,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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
  // Optional look. Absent means the default pen, so drawings saved before pen
  // colors existed load unchanged. Short names: the strokes ride in the draft.
  c?: string; // CSS color
  w?: number; // line width in CSS pixels
  h?: 1; // a highlighter stroke: wide, translucent, drawn under the ink
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
  // Highlighter strokes are not writing: a page that is only highlights is empty.
  const ink = data.strokes.filter((stroke) => !stroke.h);
  if (ink.length === 0) return true;
  const bounds = strokeBounds(ink);
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
export function exportScratchPadPng(data: ScratchPadData, options: { faithful?: boolean } = {}): string | null {
  if (isScratchPadEmpty(data)) return null;
  // The OCR image carries the writing only, in forced near-black: highlight
  // color and pen color must not change how handwriting is read. A faithful
  // render (copy as picture) keeps every stroke in its own color.
  const drawn = options.faithful ? data.strokes : data.strokes.filter((stroke) => !stroke.h);
  const bounds = strokeBounds(drawn);
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
  if (options.faithful) {
    for (const stroke of drawn.filter((st) => st.h)) drawStroke(ctx, stroke, scale, scale, scale);
    for (const stroke of drawn.filter((st) => !st.h)) drawStroke(ctx, stroke, scale, scale, scale);
  } else {
    for (const stroke of drawn) drawSmoothPath(ctx, stroke.points, scale, scale);
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
  // Drag on the grips above and below the drawing area (pointer delta in px).
  onEdgeDrag?: (edge: "top" | "bottom", phase: "start" | "move" | "end", dy: number) => void;
  // Current pen or highlighter look, for annotating the question.
  onLookChange?: (look: StrokeLook) => void;
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

const DEFAULT_INK = "#26301f";
const DEFAULT_WIDTH = 2.4;
const PEN_COLORS = [DEFAULT_INK, "#1d4ed8", "#c62828", "#2e7d32", "#7b1fa2"];
const PEN_WIDTHS = [1.6, DEFAULT_WIDTH, 4];
const HIGHLIGHT_COLORS = ["#ffe14d", "#7fe38a", "#ff9ecb", "#7cc7ff"];
const HIGHLIGHT_WIDTH = 16;
const HIGHLIGHT_ALPHA = 0.38;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;
// A canvas backing store above this many pixels is rendered at a lower density
// instead of risking the browser's memory limit when zoomed in.
const MAX_CANVAS_PIXELS = 16_000_000;
// A continuous zoom (pinch, Ctrl+wheel) is shown as a GPU scale of the page and
// the canvases are rebuilt once, this long after the last zoom event.
const ZOOM_SETTLE_MS = 140;
const ERASER_MIN_PX = 6;
const ERASER_MAX_PX = 64;
const ERASER_DEFAULT_PX = 16;

// stroke: a whole stroke goes when touched. precise: only the part under the
// eraser goes and the stroke is split around the gap. highlight: like stroke,
// but touches nothing except highlighter strokes.
type EraseMode = "stroke" | "precise" | "highlight";

type PenPrefs = { color: string; width: number; hlColor: string; eraseMode: EraseMode; eraserPx: number };

function loadPenPrefs(): PenPrefs {
  const fallback: PenPrefs = {
    color: DEFAULT_INK, width: DEFAULT_WIDTH, hlColor: HIGHLIGHT_COLORS[0], eraseMode: "stroke", eraserPx: ERASER_DEFAULT_PX,
  };
  try {
    const raw = localStorage.getItem(scopeKey("nosey_scratchpad_pen"));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PenPrefs>;
    return {
      color: PEN_COLORS.includes(parsed.color ?? "") ? (parsed.color as string) : fallback.color,
      width: PEN_WIDTHS.includes(parsed.width ?? 0) ? (parsed.width as number) : fallback.width,
      hlColor: HIGHLIGHT_COLORS.includes(parsed.hlColor ?? "") ? (parsed.hlColor as string) : fallback.hlColor,
      eraseMode: parsed.eraseMode === "precise" || parsed.eraseMode === "highlight" ? parsed.eraseMode : "stroke",
      eraserPx: Math.min(ERASER_MAX_PX, Math.max(ERASER_MIN_PX, Number(parsed.eraserPx) || ERASER_DEFAULT_PX)),
    };
  } catch {
    return fallback;
  }
}

type Tool = "pen" | "highlight" | "erase" | "select";
type SelectMode = "lasso" | "box";

function ctxOf(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  // No `desynchronized` hint: it cuts pen latency a little, but on some
  // Windows GPU/driver combinations the whole canvas paints opaque black.
  return canvas ? canvas.getContext("2d") : null;
}

type StrokeLook = Pick<Stroke, "c" | "w" | "h">;

function styleStroke(ctx: CanvasRenderingContext2D, look: StrokeLook) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (look.h) {
    ctx.strokeStyle = look.c ?? HIGHLIGHT_COLORS[0];
    ctx.lineWidth = look.w ?? HIGHLIGHT_WIDTH;
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
  } else {
    ctx.strokeStyle = look.c ?? DEFAULT_INK;
    ctx.lineWidth = look.w ?? DEFAULT_WIDTH;
    ctx.globalAlpha = 1;
  }
}

// One stroke in its own look. `widthScale` multiplies the line width, for
// renders that are not at 1 CSS pixel per unit.
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, scaleX: number, scaleY: number, widthScale = 1) {
  styleStroke(ctx, stroke);
  if (widthScale !== 1) ctx.lineWidth *= widthScale;
  drawSmoothPath(ctx, stroke.points, scaleX, scaleY);
  ctx.globalAlpha = 1;
}

// Highlighter strokes go first so ink always stays on top of them.
function drawAllStrokes(ctx: CanvasRenderingContext2D, list: Stroke[], scale: number) {
  for (const stroke of list) if (stroke.h) drawStroke(ctx, stroke, scale, scale);
  for (const stroke of list) if (!stroke.h) drawStroke(ctx, stroke, scale, scale);
}

// How many backing pixels per CSS pixel a canvas was sized at.
function canvasDensity(canvas: HTMLCanvasElement): number {
  const css = parseFloat(canvas.style.width);
  return css > 0 ? canvas.width / css : window.devicePixelRatio || 1;
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  const ctx = ctxOf(canvas);
  if (!canvas || !ctx) return;
  const dpr = canvasDensity(canvas);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
}

// What is left of a stroke after an eraser of this radius passes over (x, y).
// null means the stroke was not touched. Segments are split into short pieces
// first: simplified strokes have long straight runs with no point near the
// eraser, which would otherwise slip through it.
function eraseFromStroke(stroke: Stroke, x: number, y: number, r: number): Stroke[] | null {
  if (!strokeHit(stroke.points, x, y, r)) return null;
  const pts = stroke.points;
  const n = pts.length / 2;
  const dense: number[] = [pts[0], pts[1]];
  for (let i = 1; i < n; i++) {
    const x0 = pts[(i - 1) * 2];
    const y0 = pts[(i - 1) * 2 + 1];
    const x1 = pts[i * 2];
    const y1 = pts[i * 2 + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r / 2)));
    for (let k = 1; k <= steps; k++) dense.push(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
  }
  const out: Stroke[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 4) out.push({ ...stroke, points: roundPoints(simplifyStroke(run, SIMPLIFY_EPSILON)) });
    run = [];
  };
  for (let i = 0; i < dense.length; i += 2) {
    if (Math.hypot(dense[i] - x, dense[i + 1] - y) <= r) flush();
    else run.push(dense[i], dense[i + 1]);
  }
  flush();
  return out;
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
  | { kind: "draw"; pointerId: number; points: number[]; predicted: number[]; look: StrokeLook }
  | { kind: "erase"; pointerId: number; snapshot: Stroke[]; remaining: Stroke[] }
  | { kind: "scroll"; pointerId: number; startX: number; startY: number; startLeft: number; startTop: number }
  | { kind: "select"; pointerId: number; mode: SelectMode; points: number[] }
  | { kind: "move"; pointerId: number; startX: number; startY: number; base: Stroke[]; rest: Stroke[]; dx: number; dy: number }
  | { kind: "scale"; pointerId: number; ax: number; ay: number; startDist: number; base: Stroke[]; rest: Stroke[]; factor: number };

// Ink copied in a scratch pad, shared by every pad in the session so a part's
// work can be pasted into the next part. Never saved or sent anywhere.
let inkClipboard: { strokes: Stroke[]; source: object | null; version: number } = {
  strokes: [],
  source: null,
  version: 0,
};

function CanvasSurface({ strokes, onStrokesChange, paperStyle, onEdgeDrag, onLookChange }: CanvasSurfaceProps) {
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
  const [prefs, setPrefs] = useState<PenPrefs>(loadPenPrefs);
  // Question annotations use the highlighter when it is picked, else the pen.
  useEffect(() => {
    onLookChange?.(
      tool === "highlight" ? { h: 1, c: prefs.hlColor, w: HIGHLIGHT_WIDTH } : { c: prefs.color, w: prefs.width },
    );
  }, [tool, prefs.color, prefs.width, prefs.hlColor, onLookChange]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    try {
      localStorage.setItem(scopeKey("nosey_scratchpad_pen"), JSON.stringify(prefs));
    } catch {
      /* storage blocked: the choice just does not persist */
    }
  }, [prefs]);
  // Where the eraser is, in logical units, for its on-canvas size circle.
  const hoverRef = useRef<[number, number] | null>(null);
  const toolRef = useRef<Tool>("pen");
  toolRef.current = tool;
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  const penDownRef = useRef<Set<number>>(new Set());
  const lastSizeKeyRef = useRef("");
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
    const dpr = canvasDensity(canvas);
    const { w, h, scale } = dimsRef.current;
    const list = override ?? localStrokesRef.current;
    const key = `${w}x${h}x${scale}x${canvas.width}`;
    const prev = paintedRef.current;
    if (
      !override &&
      prev &&
      prev.key === key &&
      list.length === prev.strokes.length + 1 &&
      !list[list.length - 1].h &&
      prev.strokes.every((stroke, i) => stroke === list[i])
    ) {
      drawStroke(ctx, list[list.length - 1], scale, scale);
    } else {
      // A new highlight repaints everything: it has to go under the ink.
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      drawAllStrokes(ctx, list, scale);
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
    const { scale } = dimsRef.current;
    for (const gesture of gesturesRef.current.values()) {
      if (gesture.kind !== "draw") continue;
      styleStroke(ctx, gesture.look);
      drawSmoothPath(ctx, gesture.predicted.length ? gesture.points.concat(gesture.predicted) : gesture.points, scale, scale);
      ctx.globalAlpha = 1;
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
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      for (const stroke of shown) {
        ctx.lineWidth = stroke.h ? 2 : stroke.w ?? DEFAULT_WIDTH;
        drawSmoothPath(ctx, stroke.points, scale, scale);
      }
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
    // The eraser's size, drawn where it will act.
    const hover = hoverRef.current;
    if (hover && toolRef.current === "erase") {
      const radius = prefsRef.current.eraserPx / 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(hover[0] * scale, hover[1] * scale, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.fill();
      ctx.strokeStyle = "#6b7a5c";
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
    // Zoom scales the page, not the stored coordinates: the logical page and
    // the stroke data are the same at every zoom. Ink line widths stay in CSS
    // pixels, so zooming in gives finer control without fattening the pen.
    // Skip the rebuild when nothing that sizes the canvases has changed. A
    // mode switch or a scrollbar appearing fires several resize callbacks in a
    // row, and each rebuild clears and repaints every layer: that is the
    // flicker.
    const z = zoomRef.current;
    const sizeKey = [cssWidth, cssAvailHeight, logicalW, pageHeight, z, window.devicePixelRatio].join("x");
    if (sizeKey === lastSizeKeyRef.current) return;
    lastSizeKeyRef.current = sizeKey;
    // Zoomed in, the page is wider than the window and scrolls. Zoomed out,
    // the page still fills the window but holds more of the sheet, so zooming
    // out shows more work instead of a small page in a big empty box.
    const zoomedW = z < 1 ? Math.min(MAX_LOGICAL_WIDTH, Math.ceil(logicalW / z / 50) * 50) : logicalW;
    const pageCssWidth = z < 1 ? cssWidth : cssWidth * z;
    const scale = pageCssWidth / zoomedW;
    // Never shorter than the window: a tall window gets a taller sheet, so
    // there is no dead strip under the paper.
    const logicalH = Math.max(pageHeight, Math.floor(cssAvailHeight / scale));
    const cssHeight = logicalH * scale;
    dimsRef.current = { w: zoomedW, h: logicalH, scale };
    const wantDpr = window.devicePixelRatio || 1;
    const dpr = Math.min(wantDpr, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, pageCssWidth * cssHeight)));
    page.style.width = `${pageCssWidth}px`;
    page.style.height = `${cssHeight}px`;
    for (const canvas of canvases as HTMLCanvasElement[]) {
      canvas.width = Math.max(1, Math.round(pageCssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      canvas.style.width = `${pageCssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const ctx = ctxOf(canvas);
      if (ctx) ctx.setTransform(canvas.width / pageCssWidth, 0, 0, canvas.width / pageCssWidth, 0, 0);
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
    // Rebuild only once the size has stopped changing, and ignore sub-pixel
    // jitter, so a window that is still resizing is not repainted every tick.
    let lastW = 0;
    let lastH = 0;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box && Math.abs(box.width - lastW) < 2 && Math.abs(box.height - lastH) < 2) return;
      if (box) {
        lastW = box.width;
        lastH = box.height;
      }
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => applySizeRef.current(), 180);
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
    hoverRef.current = [x, y];
    const { scale } = dimsRef.current;
    // The size control is a diameter in CSS pixels, so it feels the same at
    // any zoom; the radius here is in logical units.
    const r = prefsRef.current.eraserPx / 2 / scale;
    const mode = prefsRef.current.eraseMode;
    let changed = false;
    let next: Stroke[];
    if (mode === "precise") {
      next = [];
      for (const stroke of gesture.remaining) {
        const pieces = eraseFromStroke(stroke, x, y, r);
        if (pieces === null) next.push(stroke);
        else {
          changed = true;
          next.push(...pieces);
        }
      }
    } else {
      next = gesture.remaining.filter((stroke) => {
        const hit = (mode !== "highlight" || stroke.h) && strokeHit(stroke.points, x, y, r);
        if (hit) changed = true;
        return !hit;
      });
    }
    if (changed) {
      gesture.remaining = next;
      paintStatic(next);
    }
    scheduleFrame();
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

  // Ink copied in any pad lives in the shared inkClipboard, so it can be
  // pasted into another part's (or question's) pad. Pasting prefers a picture
  // on the system clipboard (see the paste handler) and falls back to this.
  const padIdRef = useRef({});
  const pasteCountRef = useRef(0);
  const pasteVersionRef = useRef(-1);

  function copySelection(): boolean {
    const sel = selectedRef.current;
    if (sel.length === 0) return false;
    inkClipboard = { strokes: sel, source: padIdRef.current, version: inkClipboard.version + 1 };
    // Replace any picture on the system clipboard, or the next Ctrl+V would
    // bring that back instead of this ink.
    void navigator.clipboard?.writeText("nosey-ink").catch(() => undefined);
    setNotice("Copied. Ctrl+V pastes it here or in another part's pad.");
    return true;
  }

  function cutSelection() {
    if (copySelection()) deleteSelection();
  }

  function pasteInk(): boolean {
    const { strokes: source, source: fromPad, version } = inkClipboard;
    if (source.length === 0) return false;
    if (pasteVersionRef.current !== version) {
      // A new copy: pasted into the pad it came from it lands a step along
      // (not on top of the original); into another pad, where it was.
      pasteVersionRef.current = version;
      pasteCountRef.current = fromPad === padIdRef.current ? 0 : -1;
    }
    const prev = localStrokesRef.current;
    if (prev.length + source.length > MAX_STROKES_PER_QUESTION) {
      setNotice("The page is full. Erase something before pasting.");
      return true;
    }
    // Each further paste lands a little further along, so pastes do not stack.
    pasteCountRef.current += 1;
    const shift = DUPLICATE_OFFSET * pasteCountRef.current;
    const copies = source.map((st) => translateStroke(st, shift, shift));
    const b = strokeBounds(copies);
    if (b) ensureHeight(b.maxY);
    pushHistory(prev);
    commitStrokes([...prev, ...copies]);
    setTool("select");
    setSelection(copies);
    return true;
  }

  // The selection as a picture on the system clipboard, to paste into Kojo,
  // a document or a chat. Needs a secure context and clipboard permission.
  async function copySelectionAsPicture() {
    const sel = selectedRef.current;
    const png = sel.length ? exportScratchPadPng({ version: 1, strokes: sel }, { faithful: true }) : null;
    if (!png) {
      setNotice("Select some writing first.");
      return;
    }
    try {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
      setNotice("Copied as a picture. Paste it anywhere.");
    } catch {
      setNotice("Couldn't copy a picture here. Your browser blocked the clipboard.");
    }
  }

  // The toolbar Paste: a picture on the clipboard becomes ink, otherwise ink
  // copied in the pad is pasted. Ctrl+V does the same without the prompt.
  async function pasteFromButton() {
    try {
      // A permission prompt that is ignored never settles, so the read is
      // raced against a timer and the pad's own copy is used instead.
      const items = await Promise.race([
        navigator.clipboard.read(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("clipboard timeout")), 1500)),
      ]);
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          await importImage(await item.getType(type));
          return;
        }
        if (item.types.includes("text/html")) {
          const html = await (await item.getType("text/html")).text();
          if (/<img\b/i.test(html)) {
            await importFromClipboard([], html, item.types.slice());
            return;
          }
        }
      }
    } catch {
      /* clipboard read blocked or unsupported: fall through to the pad's own copy */
    }
    if (!pasteInk()) setNotice("Nothing to paste. Copy a picture, or select some ink and copy it.");
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
    const next = [...prev, { points: simplified, ...gesture.look }].slice(-MAX_STROKES_PER_QUESTION);
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

    if (e.pointerType === "pen") penDownRef.current.add(e.pointerId);
    if (e.pointerType === "touch") {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Two fingers anywhere zoom the page, whether a finger draws or scrolls.
      // Not while a stylus is down: a resting palm is several touch points at
      // once and must never turn writing into a zoom.
      if (touchesRef.current.size >= 2 && penDownRef.current.size === 0) {
        const [a, b] = Array.from(touchesRef.current.values());
        // The first finger may have started a stroke, scroll or selection drag:
        // drop it, the student meant a pinch.
        for (const id of Array.from(touchesRef.current.keys())) abortGesture(id);
        pinchRef.current = { startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startZoom: zoomRef.current };
        liveCanvasRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      if (pinchRef.current) return; // a third finger during a pinch does nothing
    }

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
        startX: e.clientX,
        startY: e.clientY,
        startLeft: container.scrollLeft,
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
    // The look of this stroke is fixed when it starts, so changing the pen
    // mid-stroke or later never recolors ink already on the page.
    const pen = prefsRef.current;
    const look: StrokeLook =
      tool === "highlight"
        ? { h: 1, c: pen.hlColor }
        : {
            ...(pen.color !== DEFAULT_INK ? { c: pen.color } : {}),
            ...(pen.width !== DEFAULT_WIDTH ? { w: pen.width } : {}),
          };
    gesturesRef.current.set(e.pointerId, { kind: "draw", pointerId: e.pointerId, points: [x, y], predicted: [], look });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (touchesRef.current.has(e.pointerId)) {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pinch = pinchRef.current;
      if (pinch && touchesRef.current.size === 2) {
        const [a, b] = Array.from(touchesRef.current.values());
        previewZoom(pinch.startZoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.startDist), {
          clientX: (a.x + b.x) / 2,
          clientY: (a.y + b.y) / 2,
        });
        return;
      }
    }
    const gesture = gesturesRef.current.get(e.pointerId);
    if (!gesture) {
      // Hovering with the eraser: show where it will act and how big it is.
      if (toolRef.current === "erase" && e.pointerType !== "touch") {
        hoverRef.current = toLogical(e.clientX, e.clientY);
        scheduleFrame();
      }
      return;
    }

    if (gesture.kind === "scroll") {
      const container = containerRef.current;
      if (container) {
        container.scrollTop = gesture.startTop + (gesture.startY - e.clientY);
        container.scrollLeft = gesture.startLeft + (gesture.startX - e.clientX);
      }
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

  function endTouch(pointerId: number) {
    penDownRef.current.delete(pointerId);
    touchesRef.current.delete(pointerId);
    if (touchesRef.current.size < 2 && pinchRef.current) {
      pinchRef.current = null;
      commitZoomPreview();
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    endTouch(e.pointerId);
    finalizeGesture(e.pointerId);
  }

  function handlePointerLeave(e: React.PointerEvent<HTMLCanvasElement>) {
    hoverRef.current = null;
    scheduleFrame();
    handlePointerUp(e);
  }

  // Throws a pointer's in-progress gesture away without committing it.
  function abortGesture(pointerId: number) {
    const gesture = gesturesRef.current.get(pointerId);
    if (!gesture) return;
    gesturesRef.current.delete(pointerId);
    // An abandoned erase, move or resize has been previewing its result on the
    // static layer without committing it, so the real strokes are put back.
    if (gesture.kind === "erase" || gesture.kind === "move" || gesture.kind === "scale") paintStatic();
    else if (gesture.kind === "draw") clearLive();
    drawOverlay();
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
    endTouch(e.pointerId);
    abortGesture(e.pointerId);
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

  // Sets the zoom and keeps whatever is under `anchor` (the viewport centre by
  // default) where it is, so zooming does not throw the page off screen.
  // A pinch or Ctrl+wheel in progress: the target zoom and the page point
  // (in logical units) that must stay under the fingers or the pointer.
  const previewRef = useRef<{ target: number; lx: number; ly: number; ax: number; ay: number } | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  // Shows a zoom instantly as a GPU scale of the already painted page; the
  // canvases are rebuilt once when the gesture settles. Rebuilding three
  // full-page canvases on every wheel tick or pinch frame is what made zoom
  // slow and stiff.
  function previewZoom(requested: number, anchor: { clientX: number; clientY: number }) {
    const container = containerRef.current;
    const page = pageRef.current;
    if (!container || !page) return;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requested));
    const rect = container.getBoundingClientRect();
    const ax = Math.min(rect.width, Math.max(0, anchor.clientX - rect.left));
    const ay = Math.min(rect.height, Math.max(0, anchor.clientY - rect.top));
    if (!previewRef.current) {
      const s0 = dimsRef.current.scale;
      previewRef.current = { target: next, lx: (container.scrollLeft + ax) / s0, ly: (container.scrollTop + ay) / s0, ax, ay };
    }
    const preview = previewRef.current;
    preview.target = next;
    const s0 = dimsRef.current.scale;
    const ratio = next / zoomRef.current;
    page.style.transformOrigin = `${preview.lx * s0}px ${preview.ly * s0}px`;
    page.style.transform = `scale(${ratio})`;
    setZoom(next);
    if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(commitZoomPreview, ZOOM_SETTLE_MS);
  }

  function commitZoomPreview() {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    const preview = previewRef.current;
    const container = containerRef.current;
    const page = pageRef.current;
    previewRef.current = null;
    if (!preview || !container || !page) return;
    page.style.transform = "";
    page.style.transformOrigin = "";
    zoomRef.current = preview.target;
    setZoom(preview.target);
    applySizeRef.current();
    container.scrollLeft = preview.lx * dimsRef.current.scale - preview.ax;
    container.scrollTop = preview.ly * dimsRef.current.scale - preview.ay;
  }

  function setZoomTo(requested: number, anchor?: { clientX: number; clientY: number }) {
    const container = containerRef.current;
    if (!container) return;
    if (previewRef.current) commitZoomPreview();
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requested));
    if (Math.abs(next - zoomRef.current) < 0.001) return;
    const rect = container.getBoundingClientRect();
    const ax = anchor ? anchor.clientX - rect.left : rect.width / 2;
    const ay = anchor ? anchor.clientY - rect.top : rect.height / 2;
    const before = dimsRef.current.scale;
    const lx = (container.scrollLeft + ax) / before;
    const ly = (container.scrollTop + ay) / before;
    zoomRef.current = next;
    setZoom(next);
    applySizeRef.current();
    container.scrollLeft = lx * dimsRef.current.scale - ax;
    container.scrollTop = ly * dimsRef.current.scale - ay;
  }

  // Applies a look to the selected ink: color and width go to pen strokes,
  // the highlighter color to highlighter strokes.
  function restyleSelection(look: { c?: string; w?: number; hlC?: string }) {
    const sel = selectedRef.current;
    if (sel.length === 0) return;
    const prev = localStrokesRef.current;
    const changed = sel.map((stroke) => {
      if (stroke.h) return look.hlC ? { ...stroke, c: look.hlC } : stroke;
      const next: Stroke = { ...stroke };
      if (look.c !== undefined) {
        if (look.c === DEFAULT_INK) delete next.c;
        else next.c = look.c;
      }
      if (look.w !== undefined) {
        if (look.w === DEFAULT_WIDTH) delete next.w;
        else next.w = look.w;
      }
      return next;
    });
    pushHistory(prev);
    commitStrokes(prev.map((stroke) => {
      const i = sel.indexOf(stroke);
      return i >= 0 ? changed[i] : stroke;
    }));
    setSelection(changed);
  }

  function pickInkColor(color: string) {
    setPrefs((p) => ({ ...p, color }));
    if (toolRef.current === "select") restyleSelection({ c: color });
  }

  function pickInkWidth(width: number) {
    setPrefs((p) => ({ ...p, width }));
    if (toolRef.current === "select") restyleSelection({ w: width });
  }

  function pickHighlightColor(color: string) {
    setPrefs((p) => ({ ...p, hlColor: color }));
    if (toolRef.current === "select") restyleSelection({ hlC: color });
  }

  function chooseTool(next: Tool, mode?: SelectMode) {
    if (mode) setSelectMode(mode);
    setTool(next);
    if (next !== "select") setSelection([]);
    if (next !== "erase") {
      hoverRef.current = null;
      scheduleFrame();
    }
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
  // Returns false only when the bytes are not a readable image, so a caller
  // with other candidates (Samsung Notes and Word paste HTML or untyped files)
  // can try the next one. quiet: leave the "couldn't read" notice to the caller.
  async function importImage(file: Blob, quiet = false): Promise<boolean> {
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
        return true;
      }
      const prev = localStrokesRef.current;
      const { w: pageW } = dimsRef.current;
      const startY = (strokeBounds(prev)?.maxY ?? 0) + 40;
      const fit = Math.min(2, ((pageW - 80) * 0.6) / traced.width, (MAX_LOGICAL_HEIGHT - 120 - startY) / traced.height);
      if (fit < 0.25) {
        setNotice("There isn't enough room left on the page for that image.");
        return true;
      }
      const imported = traced.strokes.map((points) => ({
        points: points.map((v, i) => round1(i % 2 === 0 ? 40 + v * fit : startY + v * fit)),
      }));
      const next = [...prev, ...imported];
      if (next.length > MAX_STROKES_PER_QUESTION || JSON.stringify({ version: 1, strokes: next }).length > MAX_STROKES_JSON_CHARS) {
        setNotice("That image is too detailed to add. Crop it to the part you need.");
        return true;
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
      return true;
    } catch {
      if (!quiet) setNotice("Couldn't read that image.");
      return false;
    }
  }

  // Pasted content that is not a plain image item: files with no type, or an
  // HTML snippet carrying an <img> (what Samsung Notes and Office put on the
  // clipboard). Each candidate is tried until one reads as a picture.
  async function importFromClipboard(files: Blob[], html: string, types: string[]) {
    for (const file of files) if (await importImage(file, true)) return;
    const src = html ? new DOMParser().parseFromString(html, "text/html").querySelector("img")?.getAttribute("src") : null;
    if (src) {
      try {
        const blob = await (await fetch(src)).blob();
        if (await importImage(blob, true)) return;
      } catch {
        /* a link the page cannot fetch (another site, a local file): fall through */
      }
    }
    const seen = types.length ? ` (it had: ${types.join(", ")})` : "";
    setNotice(`Couldn't find a picture in what you pasted${seen}. Try pasting a screenshot of your writing.`);
  }

  // Window-level handlers need the latest closures but are attached once.
  // zoomBy(0) resets to 100%.
  function zoomBy(factor: number) {
    setZoomTo(factor === 0 ? 1 : zoomRef.current * factor);
  }
  const actionsRef = useRef({ deleteSelection, undo, importImage, importFromClipboard, setSelection, copySelection, cutSelection, pasteInk, setNotice, zoomBy, setZoomTo, previewZoom });
  actionsRef.current = { deleteSelection, undo, importImage, importFromClipboard, setSelection, copySelection, cutSelection, pasteInk, setNotice, zoomBy, setZoomTo, previewZoom };

  // Ctrl+wheel (and a trackpad pinch, which arrives the same way) zooms toward
  // the pointer. Attached natively because React's wheel listener is passive
  // and could not stop the browser zooming the whole page instead.
  useEffect(() => {
    // On the window, not the canvas: the pad covers the screen, and a Ctrl+wheel
    // or trackpad pinch anywhere over it must zoom the pad, never the browser.
    // The handler returns at once for plain scrolling, so it does not slow it.
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const base = previewRef.current?.target ?? zoomRef.current;
      actionsRef.current.previewZoom(base * Math.exp(-e.deltaY * 0.01), { clientX: e.clientX, clientY: e.clientY });
    }
    // Safari's own pinch-zoom gesture.
    const stopGesture = (e: Event) => e.preventDefault();
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("gesturestart", stopGesture);
    window.addEventListener("gesturechange", stopGesture);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("gesturestart", stopGesture);
      window.removeEventListener("gesturechange", stopGesture);
    };
  }, []);

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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && hasSelection) {
        e.preventDefault();
        actionsRef.current.copySelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x" && hasSelection) {
        e.preventDefault();
        actionsRef.current.cutSelection();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        actionsRef.current.zoomBy(ZOOM_STEP);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        actionsRef.current.zoomBy(1 / ZOOM_STEP);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        actionsRef.current.zoomBy(0);
      }
    }
    function onPaste(e: ClipboardEvent) {
      if (typingTarget(e.target)) return;
      const data = e.clipboardData;
      if (!data) return;
      // Everything is read now: clipboard data is gone once the handler returns.
      const files: Blob[] = Array.from(data.files ?? []);
      for (const item of Array.from(data.items ?? [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file && !files.includes(file)) files.push(file);
      }
      const html = data.getData("text/html");
      const types = Array.from(data.types ?? []);
      if (files.length > 0 || /<img\b/i.test(html)) {
        e.preventDefault();
        void actionsRef.current.importFromClipboard(files, html, types);
        return;
      }
      // No picture on the clipboard: paste ink copied inside the pad, if any.
      if (actionsRef.current.pasteInk()) {
        e.preventDefault();
      } else if (types.length > 0) {
        e.preventDefault();
        actionsRef.current.setNotice(`That isn't a picture (it had: ${types.join(", ")}). Paste a screenshot of your writing.`);
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
          className={`scratchpad-tool-btn${tool === "pen" ? " is-active" : ""}`}
          onClick={() => chooseTool("pen")}
          aria-pressed={tool === "pen"}
          aria-label="Pen"
          title="Pen"
        >
          <PenLine size={16} />
        </button>
        <button
          type="button"
          className={`scratchpad-tool-btn${tool === "highlight" ? " is-active" : ""}`}
          onClick={() => chooseTool(tool === "highlight" ? "pen" : "highlight")}
          aria-pressed={tool === "highlight"}
          aria-label="Highlighter"
          title="Highlighter"
        >
          <Highlighter size={16} />
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
        <button
          type="button"
          className="scratchpad-tool-btn"
          onClick={() => void pasteFromButton()}
          aria-label="Paste"
          title="Paste a picture or copied ink (Ctrl+V)"
        >
          <ClipboardPaste size={16} />
        </button>
        {hasSelection ? (
          <>
            <button type="button" className="scratchpad-tool-btn" onClick={copySelection} aria-label="Copy selection" title="Copy (Ctrl+C)">
              <Clipboard size={16} />
            </button>
            <button
              type="button"
              className="scratchpad-tool-btn"
              onClick={() => void copySelectionAsPicture()}
              aria-label="Copy selection as a picture"
              title="Copy as a picture, to paste anywhere"
            >
              <ImageDown size={16} />
            </button>
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
        <div className="scratchpad-zoom" role="group" aria-label="Zoom">
          <button type="button" className="scratchpad-tool-btn" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out" title="Zoom out (Ctrl+-)">
            <ZoomOut size={16} />
          </button>
          <button type="button" className="scratchpad-zoom-label" onClick={() => zoomBy(0)} aria-label="Reset zoom to 100%" title="Reset zoom (Ctrl+0)">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="scratchpad-tool-btn" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (Ctrl++)">
            <ZoomIn size={16} />
          </button>
        </div>
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
      {tool === "pen" || tool === "highlight" || tool === "erase" || (tool === "select" && hasSelection) ? (
        <div className="scratchpad-style-bar" role="group" aria-label={tool === "erase" ? "Eraser options" : "Pen options"}>
          {tool === "erase" ? (
            <>
              <div className="scratchpad-segmented" role="group" aria-label="Eraser type">
                {(
                  [
                    ["stroke", "Stroke", "Removes a whole stroke you touch"],
                    ["precise", "Precise", "Removes only the part under the eraser"],
                    ["highlight", "Highlights", "Only removes highlighter, never writing"],
                  ] as [EraseMode, string, string][]
                ).map(([mode, label, hint]) => (
                  <button
                    key={mode}
                    type="button"
                    className={prefs.eraseMode === mode ? "is-active" : ""}
                    aria-pressed={prefs.eraseMode === mode}
                    title={hint}
                    onClick={() => setPrefs((p) => ({ ...p, eraseMode: mode }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="scratchpad-eraser-size">
                <span className="muted small">Size</span>
                {/* The same custom slider Learning Modules uses for seeking. */}
                <input
                  className="lm-dock-seek scratchpad-eraser-range"
                  type="range"
                  min={ERASER_MIN_PX}
                  max={ERASER_MAX_PX}
                  value={prefs.eraserPx}
                  style={{ "--seek-pct": `${((prefs.eraserPx - ERASER_MIN_PX) / (ERASER_MAX_PX - ERASER_MIN_PX)) * 100}%` } as CSSProperties}
                  onChange={(e) => setPrefs((p) => ({ ...p, eraserPx: Number(e.target.value) }))}
                  aria-label="Eraser size"
                  aria-valuetext={`${prefs.eraserPx} pixels`}
                />
                <span className="scratchpad-eraser-preview" aria-hidden="true">
                  <span style={{ width: prefs.eraserPx, height: prefs.eraserPx }} />
                </span>
                <span className="muted small">{prefs.eraserPx}px</span>
              </label>
            </>
          ) : tool === "highlight" ? (
            <div className="scratchpad-swatches" role="group" aria-label="Highlighter color">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`scratchpad-swatch scratchpad-swatch--highlight${prefs.hlColor === color ? " is-active" : ""}`}
                  style={{ background: color }}
                  aria-label={`Highlighter ${color}`}
                  aria-pressed={prefs.hlColor === color}
                  onClick={() => pickHighlightColor(color)}
                />
              ))}
            </div>
          ) : (
            <>
              <div className="scratchpad-swatches" role="group" aria-label="Pen color">
                {PEN_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`scratchpad-swatch${prefs.color === color ? " is-active" : ""}`}
                    style={{ background: color }}
                    aria-label={`Pen ${color}`}
                    aria-pressed={prefs.color === color}
                    onClick={() => pickInkColor(color)}
                  />
                ))}
              </div>
              <div className="scratchpad-widths" role="group" aria-label="Pen width">
                {PEN_WIDTHS.map((width) => (
                  <button
                    key={width}
                    type="button"
                    className={prefs.width === width ? "is-active" : ""}
                    aria-label={`Pen width ${width}`}
                    aria-pressed={prefs.width === width}
                    onClick={() => pickInkWidth(width)}
                  >
                    <span style={{ height: width + 1 }} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
      {notice ? (
        <p className="scratchpad-notice" role="status">
          {notice}
        </p>
      ) : null}
      {onEdgeDrag ? <EdgeGrip edge="top" onDrag={onEdgeDrag} /> : null}
      <div ref={containerRef} className="scratchpad-canvas-container">
        <div ref={pageRef} className={`scratchpad-page ${paperClass}`}>
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
            onPointerLeave={handlePointerLeave}
          />
        </div>
      </div>
      {onEdgeDrag ? <EdgeGrip edge="bottom" onDrag={onEdgeDrag} /> : null}
      <button type="button" className="scratchpad-extend-btn" onClick={addSpace} disabled={atMaxHeight}>
        <Plus size={13} />
        {atMaxHeight ? "Page is at its full length" : "Add more space"}
      </button>
    </div>
  );
}

// A bar on the drawing area's top or bottom edge that drags it taller or
// shorter. Pointer events, so a stylus or finger works (iPad is the main user).
function EdgeGrip({
  edge,
  onDrag,
}: {
  edge: "top" | "bottom";
  onDrag: (edge: "top" | "bottom", phase: "start" | "move" | "end", dy: number) => void;
}) {
  const startYRef = useRef<number | null>(null);
  return (
    <div
      className={`scratchpad-edge-grip scratchpad-edge-grip--${edge}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={edge === "top" ? "Drag up for more drawing space" : "Drag down for more drawing space"}
      title={edge === "top" ? "Drag up for more space" : "Drag down for more space"}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        startYRef.current = e.clientY;
        onDrag(edge, "start", 0);
      }}
      onPointerMove={(e) => {
        if (startYRef.current == null) return;
        onDrag(edge, "move", e.clientY - startYRef.current);
      }}
      onPointerUp={(e) => {
        if (startYRef.current == null) return;
        onDrag(edge, "end", e.clientY - startYRef.current);
        startYRef.current = null;
      }}
      onPointerCancel={() => {
        startYRef.current = null;
      }}
    >
      <span />
    </div>
  );
}

// ── Question annotations ─────────────────────────────────────────────────────

// Session only: kept while the page is open (closing and reopening the pad, or
// moving between questions, keeps them), gone on refresh. Keyed by question
// text. Never sent to the server.
const questionAnnotations = new Map<string, Stroke[]>();

// The question renders at this fixed width once it has ink on it, scaled down
// to fit a narrower pad, so text never re-wraps out from under the marks.
const ANNOTATE_WIDTH = 680;

function QuestionAnnotator({
  questionKey,
  content,
  active,
  look,
  strokes,
  onStrokesChange,
}: {
  questionKey: string;
  content: ReactNode;
  active: boolean;
  look: StrokeLook;
  strokes: Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<Stroke | null>(null);
  const [box, setBox] = useState({ avail: ANNOTATE_WIDTH, h: 0 });
  const locked = active || strokes.length > 0;
  const scale = Math.min(1, box.avail / ANNOTATE_WIDTH);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return undefined;
    const measure = () => setBox({ avail: outer.clientWidth || ANNOTATE_WIDTH, h: inner.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [locked, questionKey]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = ANNOTATE_WIDTH;
    const h = Math.max(1, box.h);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = ctxOf(canvas);
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const list = liveRef.current ? [...strokes, liveRef.current] : strokes;
    drawAllStrokes(ctx, list, 1);
  }, [strokes, box.h]);

  useEffect(() => {
    paint();
  }, [paint, locked]);

  function toLocal(e: ReactPointerEvent): [number, number] {
    const rect = innerRef.current!.getBoundingClientRect();
    return [round1((e.clientX - rect.left) / scale), round1((e.clientY - rect.top) / scale)];
  }

  if (!locked) {
    return (
      <div ref={outerRef}>
        <div ref={innerRef}>{content}</div>
      </div>
    );
  }

  return (
    <div ref={outerRef} className="scratchpad-annotate-outer" style={{ height: box.h * scale }}>
      <div
        ref={innerRef}
        className="scratchpad-annotate-inner"
        style={{ width: ANNOTATE_WIDTH, transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        {content}
        <canvas
          ref={canvasRef}
          className={`scratchpad-annotate-canvas${active ? " is-active" : ""}`}
          onPointerDown={(e) => {
            if (!active) return;
            e.preventDefault();
            (e.target as Element).setPointerCapture(e.pointerId);
            liveRef.current = { ...look, points: toLocal(e) };
            paint();
          }}
          onPointerMove={(e) => {
            const live = liveRef.current;
            if (!live || live.points.length >= MAX_POINTS_PER_STROKE) return;
            live.points.push(...toLocal(e));
            paint();
          }}
          onPointerUp={() => {
            const live = liveRef.current;
            liveRef.current = null;
            if (live) onStrokesChange([...strokes, { ...live, points: simplifyStroke(live.points, 0.6) }]);
          }}
          onPointerCancel={() => {
            liveRef.current = null;
            paint();
          }}
        />
      </div>
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────────

// The question keeps about two lines when the top grip squeezes it.
const QUESTION_MIN_HEIGHT = 44;
// Resizing never squeezes the drawing area below this, and the pad never grows
// past this share of the screen.
const CANVAS_MIN_HEIGHT = 180;
const MODAL_MAX_VIEWPORT = 0.96;

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
  // Focus hides the question and paper rows so the canvas takes nearly the
  // whole screen. The question is one click away on the same button.
  const [focus, setFocus] = useState<boolean>(() => localStorage.getItem(scopeKey("nosey_scratchpad_focus")) === "1");
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const [customSize, setCustomSize] = useState<{ w: number; h: number } | null>(null);
  // Edge grips: the top grip first shrinks the
  // question text (it scrolls), then grows the modal; the bottom grip grows
  // or shrinks the modal. The modal is centered, so growing it extends both.
  const questionRef = useRef<HTMLDivElement>(null);
  const [questionMaxH, setQuestionMaxH] = useState<number | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [annotations, setAnnotationsState] = useState<Stroke[]>(() => questionAnnotations.get(questionText) ?? []);
  const [look, setLook] = useState<StrokeLook>({ c: DEFAULT_INK, w: DEFAULT_WIDTH });
  function setAnnotations(next: Stroke[]) {
    setAnnotationsState(next);
    questionAnnotations.set(questionText, next);
  }
  const edgeStartRef = useRef<{ w: number; h: number; q: number; c: number } | null>(null);

  function handleEdgeDrag(edge: "top" | "bottom", phase: "start" | "move" | "end", dy: number) {
    if (phase === "start") {
      const card = cardRef.current?.getBoundingClientRect();
      if (!card) return;
      const canvasBox = cardRef.current?.querySelector(".scratchpad-canvas-container");
      edgeStartRef.current = {
        w: card.width,
        h: card.height,
        q: questionRef.current?.clientHeight ?? 0,
        c: canvasBox?.clientHeight ?? CANVAS_MIN_HEIGHT,
      };
      return;
    }
    const start = edgeStartRef.current;
    if (!start) return;
    if (phase === "end") edgeStartRef.current = null;
    // The pad never leaves the screen and the drawing area never shrinks below
    // CANVAS_MIN_HEIGHT, however far a grip is dragged.
    const maxH = window.innerHeight * MODAL_MAX_VIEWPORT;
    const minH = Math.max(280, start.h - Math.max(0, start.c - CANVAS_MIN_HEIGHT));
    const clampH = (h: number) => Math.min(maxH, Math.max(minH, h));
    if (edge === "bottom") {
      setCustomSize({ w: start.w, h: clampH(start.h + dy) });
      return;
    }
    // Top grip: dragging up (dy < 0) asks for -dy more pixels of canvas.
    const want = -dy;
    if (want <= 0) {
      // Dragging down gives the question room, but only what the canvas can
      // spare above its minimum.
      setQuestionMaxH(start.q + Math.min(-want, Math.max(0, start.c - CANVAS_MIN_HEIGHT)));
      return;
    }
    const fromQuestion = Math.min(want, Math.max(0, start.q - QUESTION_MIN_HEIGHT));
    setQuestionMaxH(start.q - fromQuestion);
    if (want > fromQuestion) setCustomSize({ w: start.w, h: clampH(start.h + (want - fromQuestion)) });
  }
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

  function toggleFocus() {
    const next = !focus;
    setFocus(next);
    localStorage.setItem(scopeKey("nosey_scratchpad_focus"), next ? "1" : "0");
    // Focus only means something at full size.
    if (next) changeSize("full");
  }

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
    const w = Math.min(window.innerWidth * MODAL_MAX_VIEWPORT, Math.max(360, drag.startW + (e.clientX - drag.startX)));
    const h = Math.min(window.innerHeight * MODAL_MAX_VIEWPORT, Math.max(280, drag.startH + (e.clientY - drag.startY)));
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
        className={`modal-card scratchpad-modal ${sizeClass}${focus ? " scratchpad-modal--focus" : ""}`}
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
            <div
              ref={questionRef}
              className="scratchpad-question-text"
              style={questionMaxH != null ? { maxHeight: `${questionMaxH}px`, overflowY: "auto" } : undefined}
            >
              <QuestionAnnotator
                questionKey={questionText}
                content={questionNode}
                active={annotating}
                look={look}
                strokes={annotations}
                onStrokesChange={setAnnotations}
              />
            </div>
            <div className="scratchpad-annotate-bar">
              <button
                type="button"
                className={annotating ? "is-active" : ""}
                onClick={() => setAnnotating((on) => !on)}
                aria-pressed={annotating}
                title="Mark up the question with the pen or highlighter picked below"
              >
                <Highlighter size={13} /> {annotating ? "Done annotating" : "Annotate question"}
              </button>
              {annotations.length > 0 ? (
                <>
                  <button type="button" onClick={() => setAnnotations(annotations.slice(0, -1))} title="Undo last mark">
                    <Undo2 size={13} /> Undo
                  </button>
                  <button type="button" onClick={() => setAnnotations([])} title="Clear all marks on the question">
                    <Trash2 size={13} /> Clear
                  </button>
                </>
              ) : null}
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
              <button
                type="button"
                className={focus ? "is-active" : ""}
                onClick={toggleFocus}
                aria-pressed={focus}
                aria-label={focus ? "Show the question" : "Use the whole screen for writing"}
                title={focus ? "Show the question" : "Whole screen: hide the question and paper rows"}
              >
                {focus ? <PanelTopOpen size={14} /> : <PanelTopClose size={14} />}
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
          onEdgeDrag={handleEdgeDrag}
          onLookChange={setLook}
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
