import { useEffect, useRef, useState } from "react";

// Kojo can emit a small declarative spec inside a fenced code block and it is
// rendered client-side. Nothing the model writes is executed as JS:
//   ```graph     function-plot JSON (fn strings go through its own math parser)
//   ```geometry  JSXGraph JSON, mapped through a whitelist of element types
//   ```mermaid   Mermaid text, rendered with securityLevel "strict"
//   ```chart     Plotly JSON (scatter, bar, pie only)
// Each library is lazy-loaded the first time its block type appears.

export const VISUAL_LANGS = new Set(["graph", "geometry", "mermaid", "chart"]);

export function isVisualLang(lang: string): boolean {
  return VISUAL_LANGS.has(lang.toLowerCase());
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function escapeText(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};
const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", T: "ᵀ",
};

function script(text: string, map: Record<string, string>, fallback: string): string {
  const chars = [...text];
  return chars.every((c) => c in map) ? chars.map((c) => map[c]).join("") : `${fallback}${text}`;
}

// Labels are drawn as plain SVG text, so HTML and LaTeX would print literally.
// Models still write x<sub>i</sub>, x_i, x^2 or $\|x\|$; turn the common cases
// into Unicode (xᵢ, x², ‖x‖) and drop whatever markup is left.
export function plainLabel(raw: unknown): string {
  return String(raw ?? "")
    .replace(/<sub>(.*?)<\/sub>/gi, (_, t: string) => script(t, SUB, "_"))
    .replace(/<sup>(.*?)<\/sup>/gi, (_, t: string) => script(t, SUP, "^"))
    .replace(/<[^>]*>/g, "")
    .replace(/\$/g, "")
    .replace(/\\\||\|\|/g, "‖")
    .replace(/\^\s*\{?\\circ\}?/g, "°")
    .replace(/\\(theta|alpha|beta|pi|degree|circ)\b/g, (_, w: string) =>
      ({ theta: "θ", alpha: "α", beta: "β", pi: "π", degree: "°", circ: "°" })[w] ?? w)
    .replace(/_\{([^}]*)\}|_([A-Za-z0-9])/g, (_, a?: string, b?: string) => script(a ?? b ?? "", SUB, "_"))
    .replace(/\^\{([^}]*)\}|\^([A-Za-z0-9])/g, (_, a?: string, b?: string) => script(a ?? b ?? "", SUP, "^"))
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

// Models crop the view tightly around their points, so labels hit the axes.
// Grow the requested box to contain every point with ~15% padding.
export function fitBoundingBox(spec: Record<string, any>): number[] {
  const asked =
    Array.isArray(spec.boundingbox) && spec.boundingbox.length === 4 && spec.boundingbox.every((n: unknown) => Number.isFinite(Number(n)))
      ? spec.boundingbox.map(Number)
      : null;
  const pts: number[][] = (Array.isArray(spec.elements) ? spec.elements : [])
    .filter((e: any) => e && Array.isArray(e.coords) && e.coords.length === 2)
    .map((e: any) => e.coords.map(Number))
    .filter((c: number[]) => c.every(Number.isFinite));
  if (pts.length === 0) return asked ?? [-6, 6, 6, -6];
  const xs = pts.map((c) => c[0]);
  const ys = pts.map((c) => c[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const pad = span * 0.15;
  let [left, top, right, bottom] = [Math.min(...xs) - pad, Math.max(...ys) + pad, Math.max(...xs) + pad, Math.min(...ys) - pad];
  if (asked) {
    left = Math.min(left, asked[0]);
    top = Math.max(top, asked[1]);
    right = Math.max(right, asked[2]);
    bottom = Math.min(bottom, asked[3]);
  }
  return [left, top, right, bottom];
}

function asObject(v: unknown, what: string): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what} must be a JSON object`);
  return v as Record<string, any>;
}

let uid = 0;

// Series colors shared by graph and chart so every visual matches the app.
function seriesPalette(): string[] {
  return [
    cssVar("--green-dark", "#718355"),
    cssVar("--accent-info", "#3a6478"),
    cssVar("--accent-caution", "#8a5a15"),
    cssVar("--accent-danger", "#9d3b31"),
    cssVar("--green-light-mid", "#b5c99a"),
  ];
}

// ── graph: function-plot ──────────────────────────────────────────────────────
async function renderGraph(el: HTMLElement, src: string) {
  const spec = asObject(JSON.parse(src), "graph spec");
  if (!Array.isArray(spec.data) || spec.data.length === 0) throw new Error("graph spec needs a non-empty data array");
  const { default: functionPlot } = await import("function-plot");
  const palette = seriesPalette();
  const data = spec.data.slice(0, 8).map((d: unknown, idx: number) => {
    const item = asObject(d, "graph data item");
    const out: Record<string, any> = { color: palette[idx % palette.length] };
    for (const key of ["fn", "fnType", "graphType", "closed", "range", "points", "vector", "offset", "x", "y", "r", "color", "nSamples"]) {
      if (key in item) out[key] = item[key];
    }
    return out;
  });
  const axis = (a: unknown) => {
    if (!a || typeof a !== "object") return undefined;
    const o = a as Record<string, any>;
    return { ...(Array.isArray(o.domain) ? { domain: o.domain } : {}), ...(o.label ? { label: String(o.label) } : {}) };
  };
  el.innerHTML = "";
  functionPlot({
    target: el,
    width: Math.max(260, Math.min(el.clientWidth || 520, 640)),
    height: 320,
    grid: spec.grid !== false,
    title: spec.title ? String(spec.title) : undefined,
    xAxis: axis(spec.xAxis),
    yAxis: axis(spec.yAxis),
    data,
  } as any);
}

// ── geometry: JSXGraph ───────────────────────────────────────────────────────
const GEOMETRY_TYPES = new Set(["point", "segment", "line", "circle", "polygon", "angle", "text", "arrow"]);

async function renderGeometry(el: HTMLElement, src: string) {
  const spec = asObject(JSON.parse(src), "geometry spec");
  if (!Array.isArray(spec.elements)) throw new Error("geometry spec needs an elements array");
  // Validate before loading the library so a bad spec fails fast.
  for (const raw of spec.elements) {
    const type = String(asObject(raw, "geometry element").type);
    if (!GEOMETRY_TYPES.has(type)) throw new Error(`geometry: unsupported element type "${type}"`);
  }
  const JXG: any = (await import("jsxgraph")).default;
  // jsxgraph's package "exports" hides its stylesheet, so reach it by path.
  await import("../../../node_modules/jsxgraph/distrib/jsxgraph.css");

  el.innerHTML = "";
  const boardEl = document.createElement("div");
  boardEl.id = `nosey-jxg-${++uid}`;
  boardEl.className = "jxgbox visual-geometry-board";
  el.appendChild(boardEl);

  const bb = fitBoundingBox(spec);
  const board = JXG.JSXGraph.initBoard(boardEl.id, {
    boundingbox: bb,
    axis: spec.axis !== false,
    keepaspectratio: true,
    showCopyright: false,
    // The nav buttons sat on top of the x-axis numbers; wheel zoom and
    // two-finger pan still work without them.
    showNavigation: false,
    pan: { enabled: true, needTwoFingers: true },
    zoom: { wheel: true, needShift: false },
  });

  const ink = cssVar("--ink", "#1f2937");
  const accent = cssVar("--green-dark", "#2f6b3a");
  const byId = new Map<string, any>();
  const ref = (id: unknown) => {
    const found = byId.get(String(id));
    if (!found) throw new Error(`geometry: unknown element id "${String(id)}"`);
    return found;
  };
  const pointRefs = (list: unknown, min: number) => {
    if (!Array.isArray(list) || list.length < min) throw new Error(`geometry: expected at least ${min} point ids`);
    return list.map(ref);
  };

  for (const raw of spec.elements.slice(0, 60)) {
    const e = asObject(raw, "geometry element");
    const type = String(e.type);
    if (!GEOMETRY_TYPES.has(type)) throw new Error(`geometry: unsupported element type "${type}"`);
    const label = e.name != null ? escapeText(plainLabel(e.name)) : "";
    const common = { strokeColor: accent, name: label, withLabel: !!label, label: { display: "internal", strokeColor: ink } };
    let obj: any;
    switch (type) {
      case "point": {
        if (!Array.isArray(e.coords) || e.coords.length !== 2) throw new Error("geometry: point needs coords [x, y]");
        obj = board.create("point", e.coords.map(Number), {
          ...common, name: label || escapeText(plainLabel(e.id ?? "")), withLabel: true, fillColor: accent, size: 3, fixed: e.fixed === true,
        });
        break;
      }
      case "segment":
      case "line":
      case "arrow":
        obj = board.create(type, pointRefs(e.points, 2).slice(0, 2), {
          ...common, strokeWidth: 2, label: { ...common.label, position: "top", offset: [8, 10] },
        });
        break;
      case "circle":
        if (Array.isArray(e.points)) obj = board.create("circle", pointRefs(e.points, 2).slice(0, 2), { ...common, strokeWidth: 2 });
        else obj = board.create("circle", [ref(e.center), Number(e.radius)], { ...common, strokeWidth: 2 });
        break;
      case "polygon":
        obj = board.create("polygon", pointRefs(e.points, 3), {
          ...common, fillColor: accent, fillOpacity: 0.12, borders: { strokeColor: accent, strokeWidth: 2 }, vertices: { visible: false },
        });
        break;
      case "angle":
        obj = board.create("angle", pointRefs(e.points, 3).slice(0, 3), {
          ...common, withLabel: true, name: label || "", fillColor: accent, fillOpacity: 0.2, radius: 0.8,
        });
        break;
      case "text":
        if (!Array.isArray(e.coords) || e.coords.length !== 2) throw new Error("geometry: text needs coords [x, y]");
        obj = board.create("text", [Number(e.coords[0]), Number(e.coords[1]), escapeText(plainLabel(e.text))], {
          display: "internal", strokeColor: ink, fixed: true, anchorX: "middle", anchorY: "bottom",
        });
        break;
    }
    if (e.id != null) byId.set(String(e.id), obj);
  }
  return () => JXG.JSXGraph.freeBoard(board);
}

// ── mermaid ──────────────────────────────────────────────────────────────────
// Kojo rarely remembers classDef syntax, so node roles are assigned here from
// shape: ([stadium]) and ((circle)) are start/end, {diamond} is a decision.
// Only applies to flowchart/graph diagrams; other diagram types pass through.
export function styleFlowchart(src: string): string {
  const header = src.trimStart().split("\n", 1)[0].trim();
  if (!/^(flowchart|graph)\b/i.test(header)) return src;
  const terminal = new Set<string>();
  const decision = new Set<string>();
  for (const m of src.matchAll(/(?:^|[\s;>&|-])([A-Za-z0-9_]+)\s*(\(\[|\(\(|\{\{|\{)/g)) {
    (m[2] === "{" || m[2] === "{{" ? decision : terminal).add(m[1]);
  }
  const lines = [
    src.trimEnd(),
    `  classDef default fill:${cssVar("--green-lightest", "#e9f5db")},stroke:${cssVar("--green-dark", "#718355")},stroke-width:1.5px,color:${cssVar("--ink", "#26301f")}`,
    `  classDef nosey-terminal fill:${cssVar("--green-dark", "#718355")},stroke:${cssVar("--green-dark", "#718355")},color:#ffffff,font-weight:600`,
    `  classDef nosey-decision fill:${cssVar("--accent-caution-tint", "#f6ebd8")},stroke:${cssVar("--accent-caution", "#8a5a15")},stroke-width:1.5px,color:${cssVar("--accent-caution-strong", "#6f4810")}`,
  ];
  if (terminal.size) lines.push(`  class ${[...terminal].join(",")} nosey-terminal`);
  if (decision.size) lines.push(`  class ${[...decision].join(",")} nosey-decision`);
  return lines.join("\n");
}

async function renderMermaid(el: HTMLElement, src: string) {
  const { default: mermaid } = await import("mermaid");
  const green = cssVar("--green-dark", "#718355");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      fontFamily: cssVar("--font-sans", "system-ui, sans-serif"),
      fontSize: "16px",
      primaryColor: cssVar("--green-lightest", "#e9f5db"),
      primaryBorderColor: green,
      primaryTextColor: cssVar("--ink", "#26301f"),
      lineColor: green,
      edgeLabelBackground: "#ffffff",
      tertiaryColor: "#ffffff",
    },
    flowchart: { curve: "basis", nodeSpacing: 36, rankSpacing: 44, padding: 16, wrappingWidth: 200, useMaxWidth: false },
  });
  const styled = styleFlowchart(src);
  await mermaid.parse(styled);
  const { svg } = await mermaid.render(`nosey-mmd-${++uid}`, styled);
  el.innerHTML = svg; // strict mode sanitizes the SVG with DOMPurify
}

// ── chart: Plotly ────────────────────────────────────────────────────────────
const CHART_TRACE_TYPES = new Set(["scatter", "bar", "pie"]);

async function renderChart(el: HTMLElement, src: string) {
  const spec = asObject(JSON.parse(src), "chart spec");
  if (!Array.isArray(spec.data) || spec.data.length === 0) throw new Error("chart spec needs a non-empty data array");
  const traces = spec.data.slice(0, 10).map((t: unknown) => {
    const trace = asObject(t, "chart trace");
    const type = String(trace.type ?? "scatter");
    if (!CHART_TRACE_TYPES.has(type)) throw new Error(`chart: unsupported trace type "${type}"`);
    const out: Record<string, any> = { type };
    for (const key of ["x", "y", "mode", "name", "labels", "values", "orientation", "marker", "line"]) {
      if (key in trace) out[key] = trace[key];
    }
    return out;
  });
  const lay = spec.layout && typeof spec.layout === "object" ? spec.layout : {};
  const ink = cssVar("--ink", "#1f2937");
  const layout: Record<string, any> = {
    autosize: true,
    height: 340,
    margin: { l: 50, r: 20, t: lay.title ? 40 : 20, b: 45 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: ink },
    colorway: seriesPalette(),
  };
  if (lay.title) layout.title = { text: escapeText(typeof lay.title === "string" ? lay.title : lay.title.text) };
  for (const ax of ["xaxis", "yaxis"]) {
    const a = lay[ax];
    if (a && typeof a === "object") {
      layout[ax] = {
        ...(a.title ? { title: { text: escapeText(typeof a.title === "string" ? a.title : a.title.text) } } : {}),
        ...(Array.isArray(a.range) ? { range: a.range } : {}),
      };
    }
  }
  if (lay.barmode) layout.barmode = String(lay.barmode);
  if (typeof lay.showlegend === "boolean") layout.showlegend = lay.showlegend;
  // @ts-expect-error plotly.js-basic-dist ships no type declarations
  const { default: Plotly } = await import("plotly.js-basic-dist");
  el.innerHTML = "";
  await Plotly.newPlot(el, traces, layout, { displaylogo: false, responsive: true });
  return () => Plotly.purge(el);
}

const RENDERERS: Record<string, (el: HTMLElement, src: string) => Promise<void | (() => void)>> = {
  graph: renderGraph,
  geometry: renderGeometry,
  mermaid: renderMermaid,
  chart: renderChart,
};

// ── Component ────────────────────────────────────────────────────────────────

export function VisualBlock({ lang, src }: { lang: string; src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const kind = lang.toLowerCase();

  useEffect(() => {
    const el = ref.current;
    const render = RENDERERS[kind];
    if (!el || !render) return;
    let cancelled = false;
    let cleanup: void | (() => void);
    setError(null);
    setLoading(true);
    render(el, src)
      .then((c) => {
        cleanup = c;
        if (cancelled && cleanup) cleanup();
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [kind, src]);

  if (error) {
    return (
      <div className="visual-block visual-block--error" role="note">
        <div className="visual-block-error-msg">Couldn't render this {kind}: {error}</div>
        <pre className="kojo-code-block"><code>{src}</code></pre>
      </div>
    );
  }

  return (
    <div className={`visual-block visual-block--${kind}`}>
      {loading && <div className="visual-block-pending">Drawing…</div>}
      <div ref={ref} className="visual-block-canvas" />
    </div>
  );
}

// Shown while the model is still streaming the fence (no closing ``` yet).
export function VisualPending({ lang }: { lang: string }) {
  return (
    <div className={`visual-block visual-block--${lang.toLowerCase()}`}>
      <div className="visual-block-pending">Drawing {lang.toLowerCase()}…</div>
    </div>
  );
}
