import { useEffect, useRef } from "react";

// Kojo chases a yarn ball through a Chrome-dino-style runner, drawn on a fixed
// logical canvas (960x300) that CSS scales down to fit. Everything is pixel art:
// each shape is a map of CELL-sized cells snapped to one grid, and smoothing is
// off, so the whole scene reads as a single low-res sprite sheet.
// All game state lives in a mutable ref so the component never re-renders during
// play; the HUD (score, high score, game over) is painted on the canvas itself.

const WORLD_W = 960;
const WORLD_H = 300;
const GROUND_Y = 250;

const KOJO_X = 130;
// Every sprite is a grid of CELL x CELL pixels. Dots are empty; the other
// characters map to palette colors through the sprite's own legend.
const CELL = 5;
// Kojo the cat, in profile and mid-run: tail up and curled at the left, a
// rounded body, and a head with two ears, one eye, a light muzzle and a nose.
// The bottom two rows are left clear for the animated legs.
const SPRITE_COLS = 14;
const SPRITE_ROWS = 11;
const KOJO_SPRITE = [
  ".#............",
  "#.........#..#",
  "#........#b##b",
  ".#.......###e#",
  "..#########bbn",
  "..###########.",
  "..##bbb#####..",
  "..##bbb###....",
  "..########....",
  "..............",
  "..............",
];
const KOJO_W = SPRITE_COLS * CELL;
const KOJO_H = SPRITE_ROWS * CELL;

// A boulder: lit along the top-left, shadowed toward the bottom-right.
const BOULDER_SPRITE = [
  "....llll....",
  "..llllllmm..",
  ".llllmmmmmm.",
  "llllmmmmmmdd",
  "llmmmmmmmmdd",
  "lmmmmmmmmddd",
  "mmmmmmmmdddd",
  "mmmmmmdddddd",
  ".mmmmdddddd.",
];
const BOULDER_W = 12 * CELL;
const BOULDER_H = BOULDER_SPRITE.length * CELL;

// A street lamp: dark post, warm bulb.
const LAMP_SPRITE = [
  "..dd..",
  ".dggd.",
  ".dggd.",
  "..dd..",
  "..dd..",
  "..dd..",
  "..dd..",
  "..dd..",
  "..dd..",
  "..dd..",
  "..dd..",
  "..dd..",
  "..dd..",
  "..dd..",
  "..dd..",
  ".dddd.",
  "dddddd",
];
const LAMP_W = 6 * CELL;
const LAMP_H = LAMP_SPRITE.length * CELL;

// The yarn ball is rasterized once into YARN_FRAMES pixel frames covering a full
// turn. Stepping baked frames keeps the spin on the pixel grid; ctx.rotate would
// smear the ball back into smooth curves.
//
// Each wrap thread is a great circle on a sphere, so it rasterizes as a curved
// band that sweeps around the ball as it turns. Flat stripes were the obvious
// alternative and they alias badly at this size: at some angles every cell lands
// on a stripe and the ball goes solid, at others none do and it goes bald.
const YARN_CELLS = 8;
const YARN_R = (YARN_CELLS * CELL) / 2;
const YARN_FRAMES = 12;
// Each band is [tilt out of the screen plane, phase offset around the ball].
const YARN_BANDS: [number, number][] = [
  [0.7, 0],
  [-0.6, 2.1],
];
const YARN_BAND_WIDTH = 0.2;

function buildYarnFrames(): string[][] {
  const frames: string[][] = [];
  for (let f = 0; f < YARN_FRAMES; f++) {
    const spin = (Math.PI * 2 * f) / YARN_FRAMES;
    const rows: string[] = [];
    for (let r = 0; r < YARN_CELLS; r++) {
      let row = "";
      for (let c = 0; c < YARN_CELLS; c++) {
        // Cell center in a -1..1 box, so the ball mask is a unit circle and the
        // front of the sphere is at w = sqrt(1 - u^2 - v^2).
        const u = (c + 0.5) / (YARN_CELLS / 2) - 1;
        const v = (r + 0.5) / (YARN_CELLS / 2) - 1;
        const d2 = u * u + v * v;
        if (d2 > 1) {
          row += ".";
          continue;
        }
        const w = Math.sqrt(Math.max(0, 1 - d2));
        // A cell is thread if it sits near the plane of any band's great circle.
        const onThread = YARN_BANDS.some(([tilt, phase]) => {
          const a = spin + phase;
          const nx = Math.cos(a) * Math.cos(tilt);
          const ny = Math.sin(a) * Math.cos(tilt);
          const nz = Math.sin(tilt);
          return Math.abs(u * nx + v * ny + w * nz) < YARN_BAND_WIDTH;
        });
        row += onThread ? "d" : "y";
      }
      rows.push(row);
    }
    frames.push(rows);
  }
  return frames;
}

const YARN_FRAME_SPRITES = buildYarnFrames();

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
  greenMid: string;
  amber: string;
  amberDark: string;
  white: string;
  stoneLight: string;
  stoneMid: string;
  stoneDark: string;
}

type ObstacleKind = "boulder" | "lamp";

interface Obstacle {
  x: number;
  w: number;
  h: number;
  kind: ObstacleKind;
}

interface Dust {
  x: number;
  y: number;
  life: number;
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
  yarnRoll: number;
  yarnHop: number;
  dust: Dust[];
  dustIn: number;
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
    yarnRoll: 0,
    yarnHop: 0,
    dust: [],
    dustIn: 0,
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
  if (kind === "boulder") return { x, w: BOULDER_W, h: BOULDER_H, kind };
  return { x, w: LAMP_W, h: LAMP_H, kind };
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
    // Hard pixel edges: nothing in this scene should be interpolated.
    ctx.imageSmoothingEnabled = false;

    const palette = (paletteRef.current ??= {
      ink: cssVar("--ink", "#26301f"),
      green: cssVar("--green-dark", "#718355"),
      greenLight: cssVar("--green-light", "#cfe1b9"),
      greenMid: cssVar("--green-light-mid", "#b5cf9c"),
      amber: cssVar("--warning", "#d97706"),
      amberDark: cssVar("--warning-dark", "#b45309"),
      white: "#ffffff",
      // Stone tones live only in the game; the app palette has no neutral grey.
      stoneLight: "#b9bdaa",
      stoneMid: "#8b917c",
      stoneDark: "#5d6352",
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
      const kind: ObstacleKind = Math.random() < 0.6 ? "boulder" : "lamp";
      state.obstacles.push(obstacleFor(kind, WORLD_W + 20));
    };

    const collide = (o: Obstacle): boolean => {
      // Hitbox covers the body only. The tail, ears and legs stick out past it
      // so a clipped whisker never ends a run.
      const x = KOJO_X + CELL * 3;
      const y = GROUND_Y - KOJO_H + state.kojoY + CELL * 4;
      const w = KOJO_W - CELL * 6;
      const h = KOJO_H - CELL * 5;
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
        state.groundScroll = (state.groundScroll + state.speed * dt) % (CELL * 8);
        // Roll rate follows the ground it rolls on: one radian of spin per
        // radius travelled, so the ball never looks like it is skidding.
        state.yarnRoll = (state.yarnRoll + (state.speed * dt) / YARN_R) % (Math.PI * 2);
        // A small hop on part of each turn keeps the chase lively without
        // letting the ball float free of the ground.
        state.yarnHop = Math.max(0, Math.sin(state.yarnRoll * 1.5)) * CELL * 1.6;

        // Dust kicked up at the yarn's contact point, on the pixel grid.
        state.dustIn -= state.speed * dt;
        if (state.dustIn <= 0) {
          state.dustIn = 26 + Math.random() * 22;
          state.dust.push({ x: KOJO_X + 250 - YARN_R, y: GROUND_Y - CELL, life: 1 });
        }
        for (const d of state.dust) {
          d.x -= state.speed * 0.55 * dt;
          d.y -= 22 * dt;
          d.life -= dt * 1.6;
        }
        state.dust = state.dust.filter((d) => d.life > 0);

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
        aria-label="Waiting game: make Kojo the cat jump over boulders and lamp posts while he chases a rolling yarn ball. Tap, click, or press Space to jump."
      />
    </div>
  );
}

// === Drawing ===

// Snap a coordinate to the sprite grid so nothing lands on a half pixel.
function snap(value: number): number {
  return Math.round(value / CELL) * CELL;
}

// Paint a sprite map at (x, y) using a legend of character to color. Characters
// missing from the legend are treated as empty cells.
function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: string[],
  x: number,
  y: number,
  legend: Record<string, string>,
) {
  const left = snap(x);
  const top = snap(y);
  for (let r = 0; r < sprite.length; r++) {
    const row = sprite[r];
    for (let c = 0; c < row.length; c++) {
      const color = legend[row[c]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(left + c * CELL, top + r * CELL, CELL, CELL);
    }
  }
}

function draw(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);

  drawClouds(state, p, ctx);
  drawGround(state, p, ctx);
  drawDust(state, p, ctx);
  drawYarn(state, p, ctx);
  for (const o of state.obstacles) drawObstacle(o, p, ctx);
  drawKojo(state, p, ctx);
  drawHud(state, p, ctx);
}

// Blocky clouds: four stacked bars, widest through the middle.
const CLOUD_SPRITE = [
  "..####..",
  ".######.",
  "########",
  ".####...",
];

function drawClouds(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  for (const c of state.clouds) {
    // Scale in whole cells so a larger cloud still sits on the same grid.
    const step = Math.max(1, Math.round(c.scale * 2));
    for (let r = 0; r < CLOUD_SPRITE.length; r++) {
      for (let col = 0; col < CLOUD_SPRITE[r].length; col++) {
        if (CLOUD_SPRITE[r][col] === ".") continue;
        ctx.fillStyle = r === 0 ? p.greenLight : p.greenMid;
        ctx.fillRect(snap(c.x) + col * CELL * step, snap(c.y) + r * CELL * step, CELL * step, CELL * step);
      }
    }
  }
}

function drawGround(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  // Solid crust, then a scrolling scatter of loose cells beneath it, so the
  // ground reads as moving without a single anti-aliased line.
  ctx.fillStyle = p.green;
  ctx.fillRect(0, GROUND_Y, WORLD_W, CELL);

  const offset = snap(state.groundScroll);
  ctx.fillStyle = p.greenMid;
  for (let x = -offset; x < WORLD_W + CELL * 8; x += CELL * 8) {
    ctx.fillRect(snap(x), GROUND_Y + CELL * 2, CELL * 3, CELL);
    ctx.fillRect(snap(x) + CELL * 5, GROUND_Y + CELL * 4, CELL * 2, CELL);
  }
}

function drawDust(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  for (const d of state.dust) {
    ctx.fillStyle = d.life > 0.5 ? p.greenMid : p.greenLight;
    ctx.fillRect(snap(d.x), snap(d.y), CELL, CELL);
  }
}

function drawYarn(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  const centerX = KOJO_X + 250;
  const bottom = GROUND_Y - state.yarnHop;
  const left = centerX - YARN_R;
  const top = bottom - YARN_R * 2;

  // Loose thread trailing back toward Kojo, drawn as a stepped pixel run.
  ctx.fillStyle = p.amberDark;
  for (let i = 1; i <= 7; i++) {
    const tx = left - i * CELL * 2;
    const ty = GROUND_Y - CELL - Math.round(Math.sin(state.time * 6 - i * 0.7)) * CELL;
    ctx.fillRect(snap(tx), snap(ty), CELL * 2, CELL);
  }

  // Contact shadow: a flat bar that narrows while the ball is off the ground.
  const shadowInset = Math.round(state.yarnHop / CELL) * CELL;
  ctx.fillStyle = p.greenMid;
  ctx.fillRect(snap(left) + shadowInset, GROUND_Y, YARN_R * 2 - shadowInset * 2, CELL);

  const frameIndex = Math.floor(state.yarnRoll / ((Math.PI * 2) / YARN_FRAMES)) % YARN_FRAMES;
  drawSprite(ctx, YARN_FRAME_SPRITES[frameIndex], left, top, { y: p.amber, d: p.amberDark });
}

function drawObstacle(o: Obstacle, p: Palette, ctx: CanvasRenderingContext2D) {
  if (o.kind === "boulder") {
    drawSprite(ctx, BOULDER_SPRITE, o.x, GROUND_Y - o.h, {
      l: p.stoneLight,
      m: p.stoneMid,
      d: p.stoneDark,
    });
    // Two chips so a run of boulders does not look stamped from one tile.
    ctx.fillStyle = p.stoneDark;
    ctx.fillRect(snap(o.x) + CELL * 4, snap(GROUND_Y - o.h) + CELL * 3, CELL, CELL);
    ctx.fillRect(snap(o.x) + CELL * 6, snap(GROUND_Y - o.h) + CELL * 5, CELL, CELL);
  } else {
    drawSprite(ctx, LAMP_SPRITE, o.x, GROUND_Y - o.h, { d: p.ink, g: p.amber });
    // One white cell in the bulb so the lamp has a warm center.
    ctx.fillStyle = p.white;
    ctx.fillRect(snap(o.x) + CELL * 2, snap(GROUND_Y - o.h) + CELL, CELL, CELL);
  }
}

function drawKojo(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  // Anchor at the feet so the sprite sits on the ground and the death squish
  // flattens Kojo onto it. Each map cell is CELL x CELL pixels.
  const feetY = GROUND_Y + state.kojoY;
  const runPhase = state.time * 13;
  const squish = state.over ? 0.4 : 1;

  ctx.save();
  ctx.translate(KOJO_X, snap(feetY));
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

  // legs: two pairs that alternate under the body. Lengths step in whole cells
  // rather than easing, so the run cycle stays on the pixel grid and reads as
  // a two-frame sprite animation.
  const backLift = Math.abs(Math.sin(runPhase));
  const frontLift = Math.abs(Math.sin(runPhase + Math.PI));
  const bodyBottom = 9 * CELL - SPRITE_ROWS * CELL; // y of the body's bottom edge
  // haunches at cols 3-4, front legs at cols 7-8
  for (const [c, lift] of [
    [3, backLift],
    [4, backLift],
    [7, frontLift],
    [8, frontLift],
  ] as [number, number][]) {
    const h = CELL * (lift > 0.5 ? 2 : 1);
    ctx.fillStyle = p.green;
    ctx.fillRect(c * CELL, bodyBottom, CELL, h);
    // Dark paw cell at the bottom of each leg.
    ctx.fillStyle = p.ink;
    ctx.fillRect(c * CELL, bodyBottom + h - CELL, CELL, CELL);
  }

  ctx.restore();
}

function drawHud(state: GameState, p: Palette, ctx: CanvasRenderingContext2D) {
  ctx.font = '600 20px "JetBrains Mono", ui-monospace, Consolas, monospace';
  ctx.textBaseline = "top";
  ctx.fillStyle = p.ink;
  const score = String(Math.floor(state.score)).padStart(5, "0");
  const high = String(Math.floor(state.high)).padStart(5, "0");
  ctx.fillText(`SCORE ${score}   HI ${high}`, WORLD_W - 320, 20);

  ctx.globalAlpha = 0.4;
  ctx.font = '500 15px "JetBrains Mono", ui-monospace, Consolas, monospace';
  ctx.fillText("kojo chases the yarn", 20, 20);
  ctx.globalAlpha = 1;

  if (state.over) {
    // Stepped panel: a filled block with a hard cell-wide frame, no radius and
    // no shadow, so the game-over card belongs to the same pixel world.
    const bw = CELL * 96;
    const bh = CELL * 18;
    const bx = snap((WORLD_W - bw) / 2);
    const by = snap(WORLD_H / 2 - bh / 2 - 24);
    ctx.fillStyle = p.ink;
    ctx.fillRect(bx - CELL, by - CELL, bw + CELL * 2, bh + CELL * 2);
    ctx.fillStyle = p.white;
    ctx.fillRect(bx, by, bw, bh);
    // Knock the four corner cells back out so the block has clipped corners.
    ctx.clearRect(bx - CELL, by - CELL, CELL, CELL);
    ctx.clearRect(bx + bw, by - CELL, CELL, CELL);
    ctx.clearRect(bx - CELL, by + bh, CELL, CELL);
    ctx.clearRect(bx + bw, by + bh, CELL, CELL);

    ctx.textAlign = "center";
    ctx.fillStyle = p.ink;
    ctx.font = '700 24px "JetBrains Mono", ui-monospace, Consolas, monospace';
    ctx.fillText("KOJO LOST THE YARN", WORLD_W / 2, by + CELL * 4);
    ctx.font = '500 14px "JetBrains Mono", ui-monospace, Consolas, monospace';
    ctx.fillText("PRESS SPACE TO CHASE AGAIN", WORLD_W / 2, by + CELL * 11);
    ctx.textAlign = "left";
  }
}
