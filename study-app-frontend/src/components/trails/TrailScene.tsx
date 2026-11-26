import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { KojoSprite } from "../KojoSprite";
import { TrailStop } from "./TrailStop";
import { prefersReducedMotion } from "../../lib/motion";
import {
  easeInOut,
  kojoPoint,
  kojoRest,
  signSide,
  toPercent,
  trailLayout,
  walkDuration,
  type Orientation,
  type Point,
  type TrailLayout,
} from "../../lib/trailLayout";
import type { StopState } from "../../lib/trailView";
import "../../styles/pages/pattern-trails.css";

export type SceneStop = {
  key: string;
  kind: "lesson" | "step" | "yarn" | "land" | "summit";
  short: string;
  status: string;
  state: StopState;
  glyph: ReactNode;
  ariaLabel: string;
  /** A waiting (wilted) or due (bloomed) redo beside this stop. */
  redo?: { due: boolean; label: string } | null;
  /** A storm cloud over a weak land (map). */
  storm?: string | null;
};

type Props = {
  stops: SceneStop[];
  orientation: Orientation;
  variant: "path" | "map";
  selected: number;
  onSelect: (index: number) => void;
  /** The stop Kojo rests at. */
  kojoAt: number;
  /** When set, Kojo walks from this stop to `kojoAt`, then `onWalkEnd` runs. */
  walkFrom?: number | null;
  onWalkEnd?: () => void;
  /** Floats up over Kojo once (e.g. "+1 solved"). */
  floatLabel?: string | null;
  label: string;
  /** Cards laid over the sky (title, counter). */
  children?: ReactNode;
};

function Flower({ x, y, tone, delay }: { x: number; y: number; tone: "pink" | "gold" | "lilac" | "white"; delay: number }) {
  return (
    <g className="pt-flower" style={{ animationDelay: `${-delay}s` }}>
      <path d={`M${x} ${y + 30}v-26`} className="pt-stem" />
      <g className={`pt-petals pt-petals--${tone}`}>
        <circle cx={x} cy={y} r={6} />
        <circle cx={x - 8} cy={y + 7} r={6} />
        <circle cx={x + 8} cy={y + 7} r={6} />
        <circle cx={x - 4} cy={y + 15} r={6} />
        <circle cx={x + 4} cy={y + 15} r={6} />
      </g>
      <circle cx={x} cy={y + 8} r={4} className="pt-flower-heart" />
    </g>
  );
}

/** A redo beside its stop: drooping and grey while it waits, upright and gold when due. */
function RedoFlower({ x, y, due }: { x: number; y: number; due: boolean }) {
  return (
    <g className={due ? "pt-redo-flower is-due" : "pt-redo-flower"}>
      <path d={`M${x} ${y + 34}v-28`} className={due ? "pt-stem" : "pt-stem pt-stem--wilt"} />
      <g className={due ? "pt-petals pt-petals--gold" : "pt-petals pt-petals--wilt"}>
        <circle cx={x} cy={y} r={6} />
        <circle cx={x - 7} cy={y + 6} r={6} />
        <circle cx={x + 7} cy={y + 6} r={6} />
        <circle cx={x} cy={y + 12} r={6} />
      </g>
      <circle cx={x} cy={y + 6} r={4} className="pt-flower-heart" />
    </g>
  );
}

function Tree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} className="pt-tree">
      <rect x={-4} y={0} width={8} height={30} className="pt-trunk" />
      <circle cx={0} cy={-8} r={26} className="pt-leaves" />
      <circle cx={-12} cy={-18} r={14} className="pt-leaves pt-leaves--light" />
    </g>
  );
}

function Cloud({ y, scale, duration, delay, opacity, travel }: { y: number; scale: number; duration: number; delay: number; opacity: number; travel: number }) {
  return (
    <g
      className="pt-cloud"
      style={{ animationDuration: `${duration}s`, animationDelay: `${-delay}s`, opacity, "--pt-travel": `${travel}px` } as CSSProperties}
    >
      <g transform={`translate(0 ${y}) scale(${scale})`}>
        <circle cx={50} cy={44} r={26} />
        <circle cx={88} cy={32} r={30} />
        <circle cx={126} cy={44} r={24} />
        <rect x={40} y={44} width={100} height={26} rx={13} />
      </g>
    </g>
  );
}

function StormCloud({ x, y }: { x: number; y: number }) {
  return (
    <g className="pt-storm" transform={`translate(${x - 40} ${y})`}>
      <g className="pt-storm-cloud">
        <circle cx={24} cy={22} r={16} />
        <circle cx={46} cy={14} r={20} />
        <circle cx={66} cy={24} r={14} />
        <rect x={16} y={22} width={58} height={16} rx={8} />
      </g>
      <g className="pt-rain">
        <path d="M28 44l-4 10M44 44l-4 10M60 44l-4 10" />
      </g>
    </g>
  );
}

function Backdrop({ layout, variant, skyId }: { layout: TrailLayout; variant: Props["variant"]; skyId: string }) {
  const { width: w, height: h, orientation } = layout;
  const horizontal = orientation === "horizontal";
  // Hills sit low on a wide scene and only along the top third of a tall one.
  const hills = horizontal
    ? [
        `M0 ${h * 0.46} C${w * 0.16} ${h * 0.38} ${w * 0.34} ${h * 0.43} ${w * 0.5} ${h * 0.47} C${w * 0.68} ${h * 0.52} ${w * 0.84} ${h * 0.4} ${w} ${h * 0.42} V${h} H0Z`,
        `M0 ${h * 0.58} C${w * 0.22} ${h * 0.5} ${w * 0.44} ${h * 0.6} ${w * 0.64} ${h * 0.56} C${w * 0.82} ${h * 0.52} ${w * 0.92} ${h * 0.5} ${w} ${h * 0.53} V${h} H0Z`,
        `M0 ${h * 0.72} C${w * 0.26} ${h * 0.66} ${w * 0.52} ${h * 0.74} ${w * 0.76} ${h * 0.7} C${w * 0.9} ${h * 0.68} ${w * 0.96} ${h * 0.69} ${w} ${h * 0.67} V${h} H0Z`,
      ]
    : [
        `M0 230 C${w * 0.3} 190 ${w * 0.6} 240 ${w} 210 V${h} H0Z`,
        `M0 300 C${w * 0.35} 270 ${w * 0.7} 320 ${w} 290 V${h} H0Z`,
        `M0 380 C${w * 0.3} 360 ${w * 0.65} 400 ${w} 370 V${h} H0Z`,
      ];
  const points = layout.points;
  const flowers: { x: number; y: number; tone: "pink" | "gold" | "lilac" | "white" }[] = [];
  const tones = ["pink", "white", "gold", "lilac"] as const;
  if (horizontal) {
    // Under the high stops: their signs hang above, so the ground below is free.
    points.forEach((p, i) => {
      if (signSide(layout, i) === "above") flowers.push({ x: p.x + 8, y: h - 52, tone: tones[i % 4] });
    });
    flowers.push({ x: 26, y: h - 44, tone: "pink" }, { x: w - 26, y: h - 50, tone: "lilac" });
  } else {
    // On the outer edge between stops (Kojo stands beside the stops themselves).
    points.forEach((p, i) => {
      const side = signSide(layout, i);
      if (i > 0) flowers.push({ x: side === "right" ? 34 : w - 34, y: p.y + 62, tone: tones[i % 4] });
    });
  }
  const trees = horizontal
    ? points.filter((_, i) => signSide(layout, i) === "below").slice(0, 3).map((p) => ({ x: p.x + 30, y: h * 0.4 }))
    : [];
  return (
    <svg className="pt-scene-art" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="pt-sky-top" />
          <stop offset={horizontal ? "0.62" : "0.3"} className="pt-sky-low" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#${skyId})`} />
      {/* Clear of the title card (top left) and the counter (top right). */}
      <g className="pt-sun" transform={`translate(${horizontal ? (variant === "map" ? 170 : w * 0.65) : w - 70} ${horizontal ? 88 : 70})`}>
        <g className="pt-sun-rays">
          <path d="M0 -66v16M0 50v16M-66 0h16M50 0h16M-47 -47l11 11M36 36l11 11M-47 47l11 -11M36 -36l11 -11" />
        </g>
        <circle r={32} className="pt-sun-disc" />
      </g>
      <Cloud y={horizontal ? 40 : 30} scale={horizontal ? 0.9 : 0.6} duration={70} delay={20} opacity={1} travel={w + 260} />
      <Cloud y={horizontal ? 120 : 110} scale={horizontal ? 0.65 : 0.45} duration={95} delay={60} opacity={0.85} travel={w + 260} />
      {hills.map((d, i) => (
        <path key={i} d={d} className={`pt-hill pt-hill--${i + 1}`} />
      ))}
      {trees.map((t, i) => (
        <Tree key={i} x={t.x} y={t.y} scale={0.9} />
      ))}
      {variant === "map" && horizontal ? (
        // The summit (last stop) sits on the mountain's shoulder; the flag tops the peak.
        <g className="pt-mountain" transform={`translate(${points[points.length - 1].x} ${points[points.length - 1].y + 34})`}>
          <path d="M-110 0 L0 -190 L110 0Z" className="pt-rock" />
          <path d="M0 -190 L-20 -156 L0 -164 L19 -152Z" className="pt-snow" />
          <path d="M0 -190V-240" className="pt-flag-pole" />
          <path d="M2 -238h32l-8 11 8 11H2z" className="pt-flag-cloth" />
        </g>
      ) : null}
      {flowers.map((f, i) => (
        <Flower key={i} x={f.x} y={f.y} tone={f.tone} delay={(i * 0.7) % 3.6} />
      ))}
    </svg>
  );
}

/**
 * The whimsical scene both Pattern Trails pages use: sky, sun, drifting clouds,
 * hills, flowers, a dirt trail through the stops, and Kojo walking it. All
 * ambient motion stops under reduced motion; the walk becomes a jump.
 */
export function TrailScene({
  stops,
  orientation,
  variant,
  selected,
  onSelect,
  kojoAt,
  walkFrom = null,
  onWalkEnd,
  floatLabel = null,
  label,
  children,
}: Props) {
  // The map spreads few lands over the middle instead of pinning them to the edges.
  const margin = variant === "map" ? Math.max(80, 330 - stops.length * 40) : undefined;
  const layout = useMemo(() => trailLayout(stops.length, orientation, margin), [stops.length, orientation, margin]);
  const ahead = variant === "map";
  const vertical = layout.orientation === "vertical";
  const uid = useId().replace(/:/g, "");
  const skyId = `pt-sky-${uid}`;
  const maskId = `pt-walked-${uid}`;
  // Where Kojo rests at a stop. Wide trails: on the trail, just behind the stop
  // (just past it on the map). Tall trails: the signs hang beside the stops on
  // the side the trail arrives from, so Kojo steps off to the stop's open side.
  const restDistance = useCallback(
    (i: number) => (vertical ? layout.lengths[Math.min(Math.max(i, 0), layout.points.length - 1)] : kojoRest(layout, i, ahead)),
    [layout, vertical, ahead],
  );
  const restOffset = useCallback(
    (i: number): Point => (vertical ? { x: (signSide(layout, i) === "right" ? -1 : 1) * 76, y: 10 } : { x: 0, y: 0 }),
    [layout, vertical],
  );
  const start = walkFrom != null && walkFrom !== kojoAt ? walkFrom : kojoAt;
  const [distance, setDistance] = useState(() => restDistance(start));
  const [offset, setOffset] = useState<Point>(() => restOffset(start));
  const [walking, setWalking] = useState(false);
  const [facingLeft, setFacingLeft] = useState(false);
  const [floating, setFloating] = useState<string | null>(null);
  const endRef = useRef(onWalkEnd);
  endRef.current = onWalkEnd;

  // Rest in place when the layout changes (rotation, resize across the phone line).
  useLayoutEffect(() => {
    if (walkFrom != null) return;
    setDistance(restDistance(kojoAt));
    setOffset(restOffset(kojoAt));
  }, [kojoAt, walkFrom, restDistance, restOffset]);

  useEffect(() => {
    if (walkFrom == null || walkFrom === kojoAt) return;
    const from = restDistance(walkFrom);
    const to = restDistance(kojoAt);
    const offFrom = restOffset(walkFrom);
    const offTo = restOffset(kojoAt);
    const done = () => {
      setDistance(to);
      setOffset(offTo);
      setWalking(false);
      if (floatLabel) setFloating(floatLabel);
      endRef.current?.();
    };
    if (prefersReducedMotion()) {
      done();
      return;
    }
    const duration = walkDuration(walkFrom, kojoAt);
    let raf = 0;
    let t0 = 0;
    let lastX = kojoPoint(layout, from).x + offFrom.x;
    setWalking(true);
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const t = Math.min((now - t0) / duration, 1);
      const e = easeInOut(t);
      const d = from + (to - from) * e;
      const off = { x: offFrom.x + (offTo.x - offFrom.x) * e, y: offFrom.y + (offTo.y - offFrom.y) * e };
      const x = kojoPoint(layout, d).x + off.x;
      if (Math.abs(x - lastX) > 0.3) setFacingLeft(x < lastX);
      lastX = x;
      setDistance(d);
      setOffset(off);
      if (t < 1) raf = requestAnimationFrame(tick);
      else done();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // A walk plays once per (from, to); later prop churn must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkFrom, kojoAt, layout]);

  // At rest Kojo faces the trail: the way it goes next on a wide trail, back
  // toward it when standing beside a stop on a tall one.
  useEffect(() => {
    if (walking) return;
    if (offset.x !== 0) {
      setFacingLeft(offset.x > 0);
      return;
    }
    const here = kojoPoint(layout, distance);
    const next = kojoPoint(layout, distance + 12);
    if (Math.abs(next.x - here.x) > 0.3) setFacingLeft(next.x < here.x);
  }, [walking, distance, offset, layout]);

  const base = kojoPoint(layout, distance);
  const kojo = toPercent(layout, { x: base.x + offset.x, y: base.y + offset.y });
  const walked = Math.max(0, Math.min(distance + 30, layout.total));
  const sceneStyle = {
    aspectRatio: `${layout.width} / ${layout.height}`,
  } as CSSProperties;

  return (
    <div className={`pt-scene pt-scene--${variant} pt-scene--${orientation}`} style={sceneStyle} role="group" aria-label={label}>
      <Backdrop layout={layout} variant={variant} skyId={skyId} />
      <svg className="pt-scene-art pt-scene-trail" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <path d={layout.d} pathLength={layout.total || 1} className="pt-walked-mask" style={{ strokeDasharray: `${walked} ${layout.total + 1}` }} />
          </mask>
        </defs>
        <path d={layout.d} className="pt-trail-edge" />
        <path d={layout.d} className="pt-trail" />
        <path d={layout.d} className="pt-trail-steps" mask={`url(#${maskId})`} />
        {stops.map((s, i) =>
          s.redo ? (
            <RedoFlower
              key={`redo-${s.key}`}
              x={layout.points[i].x + (layout.orientation === "horizontal" ? 44 : signSide(layout, i) === "right" ? -30 : 30)}
              y={layout.points[i].y + (layout.orientation === "horizontal" ? (signSide(layout, i) === "above" ? 20 : -54) : 30)}
              due={s.redo.due}
            />
          ) : null,
        )}
        {stops.map((s, i) => (s.storm ? <StormCloud key={`storm-${s.key}`} x={layout.points[i].x} y={layout.points[i].y - 118} /> : null))}
      </svg>
      {variant === "path" ? (
        <div className="pt-butterfly" aria-hidden="true">
          <svg width="26" height="20" viewBox="0 0 26 20">
            <g className="pt-wings">
              <ellipse cx="7" cy="8" rx="6" ry="7" />
              <ellipse cx="19" cy="8" rx="6" ry="7" />
            </g>
            <rect x="12" y="3" width="2" height="14" rx="1" className="pt-butterfly-body" />
          </svg>
        </div>
      ) : null}
      {stops.map((s, i) => (
        <TrailStop
          key={s.key}
          position={toPercent(layout, layout.points[i])}
          side={signSide(layout, i)}
          kind={s.kind}
          state={s.state}
          glyph={s.glyph}
          short={s.short}
          status={s.status}
          note={s.storm ?? s.redo?.label ?? null}
          noteTone={s.redo?.due ? "positive" : "caution"}
          selected={selected === i}
          ariaLabel={s.ariaLabel}
          onSelect={() => onSelect(i)}
        />
      ))}
      <div
        className={`pt-kojo${walking ? " is-walking" : ""}${facingLeft ? " is-left" : ""}`}
        style={{ left: kojo.left, top: kojo.top }}
        aria-hidden="true"
      >
        <KojoSprite walking={walking} width="100%" />
      </div>
      {floating ? (
        <div className="pt-float" style={{ left: kojo.left, top: kojo.top }} aria-hidden="true" onAnimationEnd={() => setFloating(null)}>
          {floating}
        </div>
      ) : null}
      {children}
    </div>
  );
}
