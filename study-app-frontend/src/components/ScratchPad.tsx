import { ChevronDown, Eraser, Hand, Maximize2, Minimize2, PenLine, Plus, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { scopeKey } from "../lib/api";
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

const MAX_STROKES_PER_QUESTION = 400;
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

// ── The canvas itself: pointer capture, dpr, replay-on-resize ──────────────

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

// Radius, in logical units, within which the stroke eraser takes a stroke out.
const ERASE_RADIUS = 16;

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
// toolbar has selected.
type Gesture =
  | { kind: "draw"; pointerId: number; points: number[] }
  | { kind: "erase"; pointerId: number; snapshot: Stroke[]; remaining: Stroke[] };

function CanvasSurface({ strokes, onStrokesChange, paperStyle }: CanvasSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const rafPendingRef = useRef(false);
  // Once a pen (stylus) touches the pad this session, ignore touch input for
  // drawing so resting a palm does not add stray strokes. No effect on mouse.
  const penSeenRef = useRef(false);
  const [allowFingerDraw, setAllowFingerDraw] = useState(true);
  const [tool, setTool] = useState<"pen" | "erase">("pen");
  const [history, setHistory] = useState<Stroke[][]>([]);
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

  const toLogical = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      // The canvas element's own rect, not the container's: the canvas may
      // stand taller than the container and scroll inside it.
      const rect = canvas.getBoundingClientRect();
      return [
        (clientX - rect.left) * (SCRATCH_PAD_LOGICAL_WIDTH / rect.width),
        (clientY - rect.top) * (pageHeight / rect.height),
      ];
    },
    [pageHeight],
  );

  // One paint path for committed strokes, the in-progress stroke, and the live
  // result of an erase drag, so all three render identically.
  const paintFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = "#26301f";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const scaleX = cssWidth / SCRATCH_PAD_LOGICAL_WIDTH;
    const scaleY = cssHeight / pageHeight;
    const gesture = gestureRef.current;
    const committed = gesture?.kind === "erase" ? gesture.remaining : strokes;
    for (const stroke of committed) drawSmoothPath(ctx, stroke.points, scaleX, scaleY);
    if (gesture?.kind === "draw") drawSmoothPath(ctx, gesture.points, scaleX, scaleY);
  }, [strokes, pageHeight]);

  // Pointer events fire faster than the display refreshes, so painting is
  // coalesced onto one animation frame rather than run per event. This is much
  // of why writing feels smoother: the main thread is no longer repainting
  // several times between frames while the pen is moving.
  const scheduleFrame = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      paintFrame();
    });
  }, [paintFrame]);

  // Held in a ref so the mount-only ResizeObserver below always calls the
  // CURRENT painter. Calling the captured one repainted the strokes as they
  // stood when the pad opened, which looked exactly like a resize wiping the
  // page: the stroke data was fine, only the canvas was stale.
  const paintFrameRef = useRef(paintFrame);
  useEffect(() => {
    paintFrameRef.current = paintFrame;
  }, [paintFrame]);

  // Any assignment to canvas.width/height clears the canvas, so sizing always
  // means: resize the backing store, re-apply the dpr transform, full replay.
  const applySize = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const cssWidth = container.clientWidth;
    if (cssWidth <= 0) return;
    // The canvas keeps the logical page's aspect ratio, so it may stand taller
    // than the container, which then scrolls.
    const cssHeight = (cssWidth / SCRATCH_PAD_LOGICAL_WIDTH) * pageHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintFrameRef.current();
  }, [pageHeight]);

  const applySizeRef = useRef(applySize);
  useEffect(() => {
    applySizeRef.current = applySize;
  }, [applySize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
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

  // Growing the page changes the backing store, so it needs the same treatment
  // as a container resize.
  useEffect(() => {
    applySizeRef.current();
  }, [pageHeight]);

  useEffect(() => {
    paintFrame();
  }, [paintFrame]);

  function eraseAt(clientX: number, clientY: number) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.kind !== "erase") return;
    const [x, y] = toLogical(clientX, clientY);
    const kept = gesture.remaining.filter((stroke) => !strokeHit(stroke.points, x, y, ERASE_RADIUS));
    if (kept.length !== gesture.remaining.length) {
      gesture.remaining = kept;
      scheduleFrame();
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "pen") penSeenRef.current = true;
    // Many styluses report their eraser tip as a pen with the eraser button
    // bit set (button 5, or bit 0x20 of buttons). Treat that as an erase
    // gesture whatever the toolbar says, since the hardware already said so.
    const stylusEraser = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 0x20) !== 0);
    const erasing = tool === "erase" || stylusEraser;
    if (!erasing && e.pointerType === "touch" && penSeenRef.current && !allowFingerDraw) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    if (erasing) {
      gestureRef.current = { kind: "erase", pointerId: e.pointerId, snapshot: strokes, remaining: strokes };
      eraseAt(e.clientX, e.clientY);
      return;
    }

    const [x, y] = toLogical(e.clientX, e.clientY);
    gestureRef.current = { kind: "draw", pointerId: e.pointerId, points: [x, y] };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;

    if (gesture.kind === "erase") {
      eraseAt(e.clientX, e.clientY);
      return;
    }

    // getCoalescedEvents returns every sample the browser batched since the
    // last frame. Keeping them is what stops fast writing from coming out
    // sparse and angular, which then transcribes badly.
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    for (const evt of events.length ? events : [native]) {
      if (gesture.points.length >= MAX_POINTS_PER_STROKE * 2) break;
      const [x, y] = toLogical(evt.clientX, evt.clientY);
      gesture.points.push(x, y);
    }
    scheduleFrame();
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    gestureRef.current = null;

    if (gesture.kind === "erase") {
      if (gesture.remaining.length !== gesture.snapshot.length) {
        setHistory((h) => [...h, gesture.snapshot]);
        onStrokesChange(gesture.remaining);
      }
      // Deliberately no repaint here. The gesture is over, so a frame drawn
      // before the parent commits the new strokes would paint the just-erased
      // strokes back for one frame. The repaint effect handles it once the
      // committed strokes arrive; if nothing was erased, the canvas is already
      // correct.
      return;
    }

    if (gesture.points.length < 4) {
      scheduleFrame();
      return; // a tap, not a stroke
    }
    const simplified = simplifyStroke(gesture.points);
    const next = [...strokes, { points: simplified }].slice(-MAX_STROKES_PER_QUESTION);
    setHistory((h) => [...h, strokes]);
    onStrokesChange(next);
  }

  function handlePointerCancel() {
    gestureRef.current = null;
    scheduleFrame();
  }

  function undo() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    onStrokesChange(prev);
  }

  function clearAll() {
    if (strokes.length === 0) return;
    setHistory((h) => [...h, strokes]);
    onStrokesChange([]);
  }

  function addSpace() {
    setPageHeight((h) => Math.min(MAX_LOGICAL_HEIGHT, h + LOGICAL_HEIGHT_STEP));
    // Two frames: one for React to commit the taller canvas, one for layout to
    // settle before scrolling down to the new space.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }),
    );
  }

  const paperClass =
    paperStyle === "lined" ? "scratchpad-paper-lined" : paperStyle === "graph" ? "scratchpad-paper-graph" : "scratchpad-paper-blank";
  const atMaxHeight = pageHeight >= MAX_LOGICAL_HEIGHT;

  return (
    <div className="scratchpad-canvas-wrap">
      <div className="scratchpad-canvas-toolbar">
        <button type="button" className="scratchpad-tool-btn" onClick={undo} disabled={history.length === 0} aria-label="Undo last stroke" title="Undo">
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className={`scratchpad-tool-btn${tool === "erase" ? " is-active" : ""}`}
          onClick={() => setTool((t) => (t === "erase" ? "pen" : "erase"))}
          aria-pressed={tool === "erase"}
          aria-label="Erase individual strokes"
          title="Erase individual strokes"
        >
          <Eraser size={16} />
        </button>
        <button
          type="button"
          className="scratchpad-tool-btn"
          onClick={clearAll}
          disabled={strokes.length === 0}
          aria-label="Clear the page"
          title="Clear the page"
        >
          <Trash2 size={16} />
        </button>
        <button
          type="button"
          className={`scratchpad-finger-toggle${allowFingerDraw ? " is-active" : ""}`}
          onClick={() => setAllowFingerDraw((v) => !v)}
          aria-pressed={allowFingerDraw}
        >
          <Hand size={14} />
          Draw with finger
        </button>
      </div>
      <div ref={containerRef} className={`scratchpad-canvas-container ${paperClass}`}>
        <canvas
          ref={canvasRef}
          className={`scratchpad-canvas${tool === "erase" ? " is-erasing" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerUp}
        />
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
              <MarkdownContent content={questionText} />
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
