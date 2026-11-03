// Pen smoothing and the scratch pad's page geometry, kept free of the DOM so
// the math that decides where ink lands and how it is drawn can be tested.
//
// Three coordinate spaces are in play:
//   logical: where strokes are stored (fixed paper units, see ScratchPad.tsx)
//   page:    CSS pixels on the page element, logical * scale
//   view:    CSS pixels in the scrolling container, page - scroll offset
// Strokes never change when the view zooms or resizes; only `scale` and the
// scroll offset do.

// ── Pen smoothing ───────────────────────────────────────────────────────────

// A speed-adaptive low-pass filter (the "1 euro" filter, Casiez et al. 2012).
// Digitizer noise is a fraction of a pixel; at writing speed it is invisible,
// but when the pen moves slowly the samples are only a pixel or two apart and
// that noise turns the line into a wobble. So the filter smooths hard when the
// pen is slow and barely at all when it is fast, where smoothing would show
// as lag and rounded corners instead. Units are CSS pixels and milliseconds.
export type InkFilter = { x: number; y: number; dx: number; dy: number; t: number };

const MIN_CUTOFF_HZ = 3;
// How fast the cutoff rises with pen speed, in Hz per CSS px/s.
const SPEED_CUTOFF = 0.1;
// The speed estimate gets its own, heavier smoothing: raw differences between
// samples a few milliseconds apart are mostly noise.
const DERIVATIVE_CUTOFF_HZ = 1;
// Assumed sample gap when a timestamp is missing or repeats (240 Hz pen).
const FALLBACK_DT_S = 1 / 240;

export function createInkFilter(x: number, y: number, t: number): InkFilter {
  return { x, y, dx: 0, dy: 0, t };
}

function smoothing(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export function filterInk(f: InkFilter, x: number, y: number, t: number): [number, number] {
  const gap = (t - f.t) / 1000;
  // Clamped above so a pause does not read as a crawl, and below for
  // coalesced samples that share a timestamp.
  const dt = gap > 0 ? Math.min(0.05, Math.max(1 / 1000, gap)) : FALLBACK_DT_S;
  if (t > f.t) f.t = t;
  const ad = smoothing(DERIVATIVE_CUTOFF_HZ, dt);
  f.dx += ad * ((x - f.x) / dt - f.dx);
  f.dy += ad * ((y - f.y) / dt - f.dy);
  const a = smoothing(MIN_CUTOFF_HZ + SPEED_CUTOFF * Math.hypot(f.dx, f.dy), dt);
  f.x += a * (x - f.x);
  f.y += a * (y - f.y);
  return [f.x, f.y];
}

type Sample = { clientX: number; clientY: number; timeStamp: number };

// Filters one event's batch of coalesced samples. Some browsers stamp every
// sample in a batch with the same time; read literally, that is one long gap
// then several instant ones, and the filter lurches once per frame (a visible
// kink every few pixels). Such a batch is spread evenly over the time since
// the last sample instead.
export function filterInkBatch(f: InkFilter, samples: Sample[]): [number, number][] {
  const n = samples.length;
  let spaced = true;
  let prev = f.t;
  for (const s of samples) {
    if (s.timeStamp - prev < 0.5) spaced = false;
    prev = s.timeStamp;
  }
  const start = f.t;
  const last = samples[n - 1]?.timeStamp ?? start;
  const end = last > start ? last : start + n * FALLBACK_DT_S * 1000;
  return samples.map((s, i) =>
    filterInk(f, s.clientX, s.clientY, spaced ? s.timeStamp : start + ((end - start) * (i + 1)) / n),
  );
}

// ── Page layout ─────────────────────────────────────────────────────────────

export type PageLimits = {
  baseWidth: number; // logical width always on the page
  inkScale: number; // most CSS px per logical unit at 100%
  maxWidth: number; // logical width cap
};

export type PageLayout = {
  scale: number; // CSS px per logical unit
  w: number; // page size, logical units
  h: number;
  cssW: number; // page size, CSS px
  cssH: number;
};

// The page for a zoom and a view size. At 100% a wide view draws ink at a
// FIXED inkScale and simply shows more page, so resizing a wide pad never
// changes the size or place of anything on it. A view narrower than the base
// page fits the base page to its width instead (phones, the Comfortable pad):
// there the ink scales with the width, smoothly, like a zoom. The scale is
// exactly fit * zoom, with no rounding: a rounded page width made the ink
// size saw up and down a few percent as the pad was resized, and made a
// committed zoom land at a slightly different size than its preview.
export function pageLayout(
  p: { zoom: number; viewW: number; viewH: number; inkRight: number; minHeight: number },
  limits: PageLimits,
): PageLayout {
  const fit = Math.min(limits.inkScale, p.viewW / limits.baseWidth);
  const scale = fit * p.zoom;
  // Zoomed in, the page keeps its 100% width and scrolls; zoomed out, it
  // still fills the view and holds more of the sheet. Ink past the edge (a
  // drawing from a wider screen) widens the page, it never shrinks the ink.
  const w = Math.min(limits.maxWidth, Math.max(limits.baseWidth, p.viewW / (fit * Math.min(1, p.zoom)), p.inkRight));
  // Never shorter than the view, so there is no dead strip under the paper.
  const h = Math.max(p.minHeight, p.viewH / scale);
  return { scale, w, h, cssW: w * scale, cssH: h * scale };
}

// The scroll offset that keeps logical point (lx, ly) at view point (ax, ay),
// clamped to what the page can actually scroll to. Computing the clamp here,
// rather than leaving it to the browser, is what lets a zoom preview show
// exactly where the committed zoom will land.
export function scrollForAnchor(
  layout: PageLayout,
  viewW: number,
  viewH: number,
  lx: number,
  ly: number,
  ax: number,
  ay: number,
): { left: number; top: number } {
  return {
    left: Math.min(Math.max(0, layout.cssW - viewW), Math.max(0, lx * layout.scale - ax)),
    top: Math.min(Math.max(0, layout.cssH - viewH), Math.max(0, ly * layout.scale - ay)),
  };
}

// ── Canvas window ───────────────────────────────────────────────────────────

// The part of the page the canvases cover, in page CSS px, and their backing
// pixels per CSS px. A page that fits the pixel budget at full density gets
// canvases covering all of it, which scroll with the page for free. A bigger
// one (zoomed in, or a long page) gets canvases covering the view plus a
// margin, moved as the view scrolls, so the ink stays sharp at every zoom
// instead of the whole page dropping to a blurry density.
export type CanvasWindow = {
  ox: number;
  oy: number;
  w: number;
  h: number;
  density: number;
  windowed: boolean;
  pageW: number; // page size rounded up to whole CSS px
  pageH: number;
};

export function canvasWindow(
  layout: PageLayout,
  viewW: number,
  viewH: number,
  left: number,
  top: number,
  dpr: number,
  maxPixels: number,
  margin: number,
): CanvasWindow {
  const pageW = Math.max(1, Math.ceil(layout.cssW));
  const pageH = Math.max(1, Math.ceil(layout.cssH));
  if (pageW * pageH * dpr * dpr <= maxPixels) {
    return { ox: 0, oy: 0, w: pageW, h: pageH, density: dpr, windowed: false, pageW, pageH };
  }
  const w = Math.min(pageW, Math.ceil(viewW) + 2 * margin);
  const h = Math.min(pageH, Math.ceil(viewH) + 2 * margin);
  // Whole CSS pixels, so the canvas sits on the pixel grid and is not resampled.
  const ox = Math.round(Math.min(pageW - w, Math.max(0, left - (w - viewW) / 2)));
  const oy = Math.round(Math.min(pageH - h, Math.max(0, top - (h - viewH) / 2)));
  return { ox, oy, w, h, density: Math.min(dpr, Math.sqrt(maxPixels / (w * h))), windowed: true, pageW, pageH };
}

// True when the view has scrolled within `slack` CSS px of a window edge that
// is not also the page edge, so the window should be moved before the view
// runs off it.
export function windowNeedsMove(
  win: CanvasWindow,
  viewW: number,
  viewH: number,
  left: number,
  top: number,
  slack: number,
): boolean {
  if (!win.windowed) return false;
  return (
    (win.ox > 0 && left - win.ox < slack) ||
    (win.ox + win.w < win.pageW && win.ox + win.w - (left + viewW) < slack) ||
    (win.oy > 0 && top - win.oy < slack) ||
    (win.oy + win.h < win.pageH && win.oy + win.h - (top + viewH) < slack)
  );
}
