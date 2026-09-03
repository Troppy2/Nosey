import { useEffect, useRef } from "react";

// Kojo chases a yarn ball through a Chrome-dino-style runner, drawn on a fixed
// logical canvas (960x300) that CSS scales down to fit. All game state lives in
// a mutable ref so the component never re-renders during play; the HUD (score,
// high score, game over) is painted on the canvas itself.

const WORLD_W = 960;
const WORLD_H = 300;
const GROUND_Y = 252;

const KOJO_X = 130;
// Kojo is drawn as pixel art: a SPRITE_COLS x SPRITE_ROWS map of cells, each
// CELL pixels square. Dots are empty, "#" is fur, "b" is the light belly patch
// and "e" is the eye. Legs are drawn separately so the two pairs can animate.
const CELL = 5;
const SPRITE_COLS = 13;
const SPRITE_ROWS = 10;
const KOJO_SPRITE = [
  ".........#.#.",
  "#.......##.##",
  "##......#####",
  ".##########e#",
  ".############",
  "..##bbb##....",
  "..##bbb##....",
  "..########...",
  ".............",
  ".............",
];
const KOJO_W = SPRITE_COLS * CELL;
const KOJO_H = SPRITE_ROWS * CELL;

const GRAVITY = 2600;
const JUMP_VELOCITY = -840;
const HOLD_GRAVITY_SCALE = 0.4;
const BASE_SPEED = 290;
const MAX_EXTRA_SPEED = 300;
const SCORE_PER_PX = 1 / 10;

const BEST_KEY = "nosey_waiting_game_best";

// Colors resolved once from the app's CSS variables and reused by every draw
// helper (they take a single Palette instead of repeating inline shapes).
interface Palette {
  ink: string;
  green: string;
  greenLight: string;
  amber: string;
  amberDark: string;
  white: string;
  water: string;
  waterDeep: string;
}

type ObstacleKind = "water" | "lamp";

interface Obstacle {
  x: number;
  w: number;
  h: number;
  kind: ObstacleKind;
}

interface GameState {
  running: boolean;
  over: boolean;
  overAt: number;
  kojoY: number;
  kojoVy: number;
  grounded: boolean;
  speed: number;
  score: number;
  high: number;
  distance: number;
  obstacles: Obstacle[];
  spawnIn: number;
  groundScroll: number;
  time: number;
  clouds: { x: number; y: number; scale: number }[];
  yarnRotate: number;
}

function makeState(): GameState {
  return {
    running: true,
    over: false,
    overAt: 0,
    kojoY: 0,
    kojoVy: 0,
    grounded: true,
    speed: BASE_SPEED,
    score: 0,
    high: loadHigh(),
    distance: 0,
    obstacles: [],
    spawnIn: 60,
    groundScroll: 0,
    time: 0,
    clouds: [
      { x: 160, y: 60, scale: 1 },
      { x: 480, y: 110, scale: 0.7 },
      { x: 800, y: 40, scale: 1.2 },
    ],
    yarnRotate: 0,
  };
}

function loadHigh(): number {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function saveHigh(score: number) {
  try {
    window.localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // storage can be blocked in private mode; the game still works
  }
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function obstacleFor(kind: ObstacleKind, x: number): Obstacle {
  if (kind === "water") return { x, w: 84, h: 34, kind };
  return { x, w: 28, h: 84, kind };
}

export default function KojoRunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const jumpHeldRef = useRef(false);
  const paletteRef = useRef<Palette | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const palette = (paletteRef.current ??= {
      ink: cssVar("--ink", "#26301f"),
      green: cssVar("--green-dark", "#718355"),
      greenLight: cssVar("--green-light", "#cfe1b9"),
      amber: cssVar("--warning", "#d97706"),
      amberDark: cssVar("--warning-dark", "#b45309"),
      white: "#ffffff",
      // Water blues live only in the game; the app palette has no blue token.
      water: "#a5d0ea",
      waterDeep: "#4e84ad",
    });

    const state = makeState();

    const jump = () => {
      if (state.over) {
        // Restart. Ignore the tap that caused the death.
        if (performance.now() - state.overAt > 350) restart();
        return;
      }
      if (state.grounded) {
        state.grounded = false;
        state.kojoVy = JUMP_VELOCITY;
      }
    };

    const restart = () => {
      // Mutate the captured state in place so every closure keeps working; the
      // run that just ended may have set a new high score.
      Object.assign(state, makeState(), { high: Math.max(state.high, Math.floor(state.score)) });
      saveHigh(state.high);
    };

    const isInteractive = (el: Element | null) =>
      !!el && (el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.code !== "ArrowUp" && e.code !== "KeyW") return;
      // Let Space/Enter activate a focused button (e.g. "Check again") instead of
      // hijacking it for a jump.
      if (e.code === "Space" && isInteractive(document.activeElement)) return;
      e.preventDefault();
      jumpHeldRef.current = true;
      jump();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        jumpHeldRef.current = false;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      jump();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);

    let rafId = 0;
    let last = performance.now();

    const spawnObstacle = () => {
      const kind: ObstacleKind = Math.random() < 0.5 ? "water" : "lamp";
      state.obstacles.push(obstacleFor(kind, WORLD_W + 20));
    };

    const collide = (o: Obstacle): boolean => {
      const x = KOJO_X + 12;
      const y = GROUND_Y - KOJO_H + state.kojoY + 8;
      const w = KOJO_W - 22;
      const h = KOJO_H - 14;
      // Shrink the obstacle hitbox a touch so near-misses feel fair.
      const ox = o.x + 6;
      const oy = GROUND_Y - o.h + 4;
      const ow = o.w - 12;
      const oh = o.h - 6;
      return x < ox + ow && x + w > ox && y < oy + oh && y + h > oy;
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      state.time += dt;

      if (!state.over) {
        const hold = jumpHeldRef.current && state.kojoVy < 0 ? HOLD_GRAVITY_SCALE : 1;
        if (!state.grounded) {
          state.kojoVy += GRAVITY * hold * dt;
          state.kojoY += state.kojoVy * dt;
          if (state.kojoY >= 0) {
            state.kojoY = 0;
            state.kojoVy = 0;
            state.grounded = true;
          }
        }

        state.speed = BASE_SPEED + Math.min(state.distance * 0.12, MAX_EXTRA_SPEED);
        state.distance += state.speed * dt;
        state.score = state.distance * SCORE_PER_PX;
        state.groundScroll = (state.groundScroll + state.speed * dt) % 42;
        state.yarnRotate += (state.speed * dt) / 22;

        state.spawnIn -= state.speed * dt;
        if (state.spawnIn <= 0) {
          spawnObstacle();
          state.spawnIn = 430 + Math.random() * 320;
        }

        for (const o of state.obstacles) o.x -= state.speed * dt;
        state.obstacles = state.obstacles.filter((o) => o.x + o.w > -40);
        for (const c of state.clouds) {
          c.x -= state.speed * 0.18 * dt;
          if (c.x < -140) {
            c.x = WORLD_W + 80;
            c.y = 30 + Math.random() * 90;
          }
        }

        if (state.obstacles.some(collide)) {
          state.over = true;
          state.overAt = now;
          const final = Math.floor(state.score);
          if (final >= state.high) {
            state.high = final;
            saveHigh(final);
          }
        }
      }

      draw(state, palette, ctx);
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <div className="waiting-game">
      <canvas
        ref={canvasRef}
        width={WORLD_W}
        height={WORLD_H}
        role="img"
        aria-label="Waiting game: make Kojo the cat jump over obstacles while he chases a yarn ball. Tap, click, or press Space to jump."
      />
    </div>
  );
}

// === Drawing ===

function draw(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);

  // Clouds (slow parallax)
  ctx.fillStyle = p.greenLight;
  for (const c of state.clouds) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 26 * c.scale, 0, Math.PI * 2);
    ctx.arc(c.x + 28 * c.scale, c.y + 4 * c.scale, 20 * c.scale, 0, Math.PI * 2);
    ctx.arc(c.x - 28 * c.scale, c.y + 4 * c.scale, 20 * c.scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ground line + scrolling dashes
  ctx.strokeStyle = p.green;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(WORLD_W, GROUND_Y);
  ctx.stroke();
  ctx.strokeStyle = "rgba(113, 131, 85, 0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = -state.groundScroll; x < WORLD_W + 42; x += 42) {
    ctx.moveTo(x, GROUND_Y + 14);
    ctx.lineTo(x + 18, GROUND_Y + 14);
  }
  ctx.stroke();

  drawYarn(state, p, ctx);
  for (const o of state.obstacles) drawObstacle(o, p, ctx);
  drawKojo(state, p, ctx);
  drawHud(state, p, ctx);
}

function drawYarn(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  const x = KOJO_X + 250;
  const y = GROUND_Y - 16 + Math.sin(state.time * 5) * 3;
  const r = 15;

  // trailing thread
  ctx.strokeStyle = p.amber;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - 4, y + 4);
  ctx.quadraticCurveTo(x - 34, y + 26, x - 26, GROUND_Y - 2);
  ctx.stroke();

  ctx.fillStyle = p.amber;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // wrap lines use a darker thread so they read on the amber ball
  ctx.strokeStyle = p.amberDark;
  ctx.lineWidth = 3.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(state.yarnRotate);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
  ctx.moveTo(-r * 0.7, 0);
  ctx.lineTo(r * 0.7, 0);
  ctx.stroke();
  ctx.restore();
}

function drawObstacle(o: Obstacle, p: Palette, ctx: CanvasRenderingContext2D) {
  if (o.kind === "water") {
    // A pool of water: a soft blue circle with a deep rim, a white shine arc
    // and a ripple ring so it reads as liquid rather than a solid blob.
    const cx = o.x + o.w / 2;
    const cy = GROUND_Y - o.h / 2;
    ctx.fillStyle = p.water;
    ctx.beginPath();
    ctx.ellipse(cx, cy, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.waterDeep;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // shine arc on the upper left
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx - o.w * 0.2, cy - o.h * 0.25, o.w * 0.2, Math.PI * 1.1, Math.PI * 1.8);
    ctx.stroke();
    // inner ripple ring
    ctx.strokeStyle = p.waterDeep;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, o.w * 0.2, o.h * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // A street lamp: thin dark pole with a glowing amber head and light rays.
    const cx = o.x + o.w / 2;
    const top = GROUND_Y - o.h;
    // light rays fanning out from the head
    ctx.strokeStyle = "rgba(217, 119, 6, 0.45)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, top + 14);
    ctx.lineTo(cx - 14, top + 44);
    ctx.moveTo(cx, top + 14);
    ctx.lineTo(cx + 14, top + 44);
    ctx.stroke();
    // pole + base
    ctx.fillStyle = p.ink;
    ctx.fillRect(cx - 3, top + 16, 6, o.h - 22);
    ctx.fillRect(o.x + 3, GROUND_Y - 6, o.w - 6, 6);
    // lamp head
    ctx.fillStyle = p.ink;
    ctx.fillRect(cx - 8, top + 4, 16, 10);
    // warm glowing bulb
    ctx.fillStyle = p.amber;
    ctx.beginPath();
    ctx.arc(cx, top + 14, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 244, 214, 0.95)";
    ctx.beginPath();
    ctx.arc(cx, top + 12, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawKojo(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  // Anchor at the feet so the sprite sits on the ground and the death squish
  // flattens Kojo onto it. Each map cell is CELL x CELL pixels.
  const feetY = GROUND_Y + state.kojoY;
  const runPhase = state.time * 13;
  const squish = state.over ? 0.35 : 1;

  ctx.save();
  ctx.translate(KOJO_X, Math.round(feetY));
  ctx.scale(1, squish);

  const cell = (c: number, r: number, color: string, h = CELL) => {
    ctx.fillStyle = color;
    ctx.fillRect(c * CELL, r * CELL - SPRITE_ROWS * CELL, CELL, h);
  };

  // body + tail + head from the pixel map
  for (let r = 0; r < SPRITE_ROWS; r++) {
    const row = KOJO_SPRITE[r];
    for (let c = 0; c < SPRITE_COLS; c++) {
      const ch = row[c];
      if (ch === ".") continue;
      cell(c, r, ch === "b" ? p.greenLight : ch === "e" ? p.ink : p.green);
    }
  }

  // legs: two pairs that alternate, hanging from the body bottom edge down to
  // the ground. The extended pair plants at the ground line, the tucked pair
  // lifts, and both compress with the body under the squish.
  const backLift = Math.abs(Math.sin(runPhase));
  const frontLift = Math.abs(Math.sin(runPhase + Math.PI));
  const bodyBottom = 7 * CELL - SPRITE_ROWS * CELL + CELL; // y of body bottom edge
  // back pair at cols 3-4, front pair at cols 6-7
  for (const [c, lift] of [
    [3, backLift],
    [4, backLift],
    [6, frontLift],
    [7, frontLift],
  ] as [number, number][]) {
    const h = Math.max(4, Math.round(CELL * (1 + lift)));
    ctx.fillStyle = p.ink;
    ctx.fillRect(c * CELL, bodyBottom, CELL, h);
  }

  ctx.restore();
}

function drawHud(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  ctx.font = '600 20px "JetBrains Mono", ui-monospace, Consolas, monospace';
  ctx.textBaseline = "top";
  ctx.fillStyle = p.ink;
  const score = String(Math.floor(state.score)).padStart(5, "0");
  const high = String(Math.floor(state.high)).padStart(5, "0");
  ctx.fillText(`SCORE ${score}   HI ${high}`, WORLD_W - 318, 16);

  ctx.globalAlpha = 0.4;
  ctx.font = '500 15px "JetBrains Mono", ui-monospace, Consolas, monospace';
  ctx.fillText("kojo chases the yarn", 18, 18);
  ctx.globalAlpha = 1;

  if (state.over) {
    const bw = 520;
    const bx = (WORLD_W - bw) / 2;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.strokeStyle = "rgba(113, 131, 85, 0.3)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, WORLD_H / 2 - 48, bw, 96, 12);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = p.ink;
    ctx.font = '700 32px "Lora", Georgia, serif';
    ctx.fillText("Oh no, Kojo tripped!", WORLD_W / 2, WORLD_H / 2 - 32);
    ctx.font = '500 16px "Inter", sans-serif';
    ctx.fillText("Tap, click, or press Space to try again", WORLD_W / 2, WORLD_H / 2 + 12);
    ctx.textAlign = "left";
  }
}