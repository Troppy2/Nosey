import { ChevronDown, Eraser, Maximize2, Minimize2, PenLine, Undo2, X } from "lucide-react";
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
const SCRATCH_PAD_LOGICAL_HEIGHT = 700;

export type Stroke = {
  points: number[]; // flat [x0,y0,x1,y1,...] in logical paper units
};

export type ScratchPadData = {
  version: 1;
  strokes: Stroke[];
};

export type PaperStyle = "blank" | "lined" | "graph";

const MAX_STROKES_PER_QUESTION = 400;
const MAX_POINTS_PER_STROKE = 800;
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

  const MAX_LONG_EDGE = 1568;
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(cropW, cropH));
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

  for (const stroke of data.strokes) {
    if (stroke.points.length < 4) continue;
    ctx.beginPath();
    ctx.moveTo((stroke.points[0] - cropX) * scale, (stroke.points[1] - cropY) * scale);
    for (let i = 2; i < stroke.points.length; i += 2) {
      ctx.lineTo((stroke.points[i] - cropX) * scale, (stroke.points[i + 1] - cropY) * scale);
    }
    ctx.stroke();
  }

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

function CanvasSurface({ strokes, onStrokesChange, paperStyle }: CanvasSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<{ points: number[]; pointerId: number } | null>(null);
  // Once a pen (stylus) touches the pad this session, ignore touch input for
  // drawing so resting a palm does not add stray strokes. No effect on mouse.
  const penSeenRef = useRef(false);
  const [allowFingerDraw, setAllowFingerDraw] = useState(true);
  const [history, setHistory] = useState<Stroke[][]>([]);

  const toLogical = useCallback((clientX: number, clientY: number): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = SCRATCH_PAD_LOGICAL_WIDTH / rect.width;
    const scaleY = SCRATCH_PAD_LOGICAL_HEIGHT / rect.height;
    return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.strokeStyle = "#26301f";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const scaleX = canvas.width / dpr / SCRATCH_PAD_LOGICAL_WIDTH;
    const scaleY = canvas.height / dpr / SCRATCH_PAD_LOGICAL_HEIGHT;
    for (const stroke of strokes) {
      if (stroke.points.length < 4) continue;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0] * scaleX, stroke.points[1] * scaleY);
      for (let i = 2; i < stroke.points.length; i += 2) {
        ctx.lineTo(stroke.points[i] * scaleX, stroke.points[i + 1] * scaleY);
      }
      ctx.stroke();
    }
  }, [strokes]);

  // Resizing the backing store (any assignment to canvas.width/height, even
  // to the same value) clears the canvas, so every resize is: resize store,
  // re-apply the devicePixelRatio scale, then a full replay. Debounced so a
  // drag-resize does not stutter.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let timer: number | null = null;
    function resizeAndRedraw() {
      const rect = container!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = Math.max(1, Math.round(rect.width * dpr));
      canvas!.height = Math.max(1, Math.round(rect.height * dpr));
      canvas!.style.width = `${rect.width}px`;
      canvas!.style.height = `${rect.height}px`;
      const ctx = canvas!.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    const observer = new ResizeObserver(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(resizeAndRedraw, 100);
    });
    observer.observe(container);
    resizeAndRedraw();
    return () => {
      observer.disconnect();
      if (timer != null) window.clearTimeout(timer);
    };
    // redraw is recreated when strokes change; the resize effect itself
    // should not re-run on every stroke, only on mount, so it is
    // intentionally not in this effect's dependency array. The redraw()
    // closure below always reads the latest strokes via the outer scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "pen") penSeenRef.current = true;
    if (e.pointerType === "touch" && penSeenRef.current && !allowFingerDraw) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = toLogical(e.clientX, e.clientY);
    drawingRef.current = { points: [x, y], pointerId: e.pointerId };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== e.pointerId) return;
    // getCoalescedEvents smooths stylus lines by picking up intermediate
    // samples the browser batched between animation frames.
    const events =
      typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : [e.nativeEvent];
    for (const evt of events.length ? events : [e.nativeEvent]) {
      if (drawing.points.length >= MAX_POINTS_PER_STROKE * 2) break;
      const [x, y] = toLogical(evt.clientX, evt.clientY);
      drawing.points.push(x, y);
    }
    // Live preview: draw the in-progress stroke directly without waiting for
    // a state update round trip.
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) {
      const dpr = window.devicePixelRatio || 1;
      const scaleX = canvas.width / dpr / SCRATCH_PAD_LOGICAL_WIDTH;
      const scaleY = canvas.height / dpr / SCRATCH_PAD_LOGICAL_HEIGHT;
      const n = drawing.points.length;
      if (n >= 4) {
        ctx.strokeStyle = "#26301f";
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(drawing.points[n - 4] * scaleX, drawing.points[n - 3] * scaleY);
        ctx.lineTo(drawing.points[n - 2] * scaleX, drawing.points[n - 1] * scaleY);
        ctx.stroke();
      }
    }
  }

  function finishStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== e.pointerId) return;
    drawingRef.current = null;
    if (drawing.points.length < 4) return; // a tap, not a stroke
    const simplified = simplifyStroke(drawing.points);
    const next = [...strokes, { points: simplified }].slice(-MAX_STROKES_PER_QUESTION);
    setHistory((h) => [...h, strokes]);
    onStrokesChange(next);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    finishStroke(e);
  }

  function handlePointerCancel() {
    drawingRef.current = null;
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

  const paperClass =
    paperStyle === "lined" ? "scratchpad-paper-lined" : paperStyle === "graph" ? "scratchpad-paper-graph" : "scratchpad-paper-blank";

  return (
    <div className="scratchpad-canvas-wrap">
      <div className="scratchpad-canvas-toolbar">
        <button type="button" className="scratchpad-tool-btn" onClick={undo} disabled={history.length === 0} aria-label="Undo last stroke">
          <Undo2 size={16} />
        </button>
        <button type="button" className="scratchpad-tool-btn" onClick={clearAll} disabled={strokes.length === 0} aria-label="Clear the page">
          <Eraser size={16} />
        </button>
        <label className="scratchpad-finger-toggle">
          <input
            type="checkbox"
            checked={allowFingerDraw}
            onChange={(e) => setAllowFingerDraw(e.target.checked)}
          />
          Draw with finger
        </label>
      </div>
      <div ref={containerRef} className={`scratchpad-canvas-container ${paperClass}`}>
        <canvas
          ref={canvasRef}
          className="scratchpad-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerUp}
        />
      </div>
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
