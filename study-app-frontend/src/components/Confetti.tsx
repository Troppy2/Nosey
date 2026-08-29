import { useCallback, useEffect, useRef, useState } from "react";

// Confetti for milestone celebrations (e.g. finishing a whole learning track).
// Zero dependencies: a full-viewport canvas with physics-driven particles.
// Use the useConfetti() hook, which returns { fire, element }:
//
//   const { fire, element } = useConfetti();
//   ...
//   <button onClick={() => fire()}>Done</button>
//   {element}
//
// Each fire() spawns an independent burst layer; bursts clean themselves up.

const CONFETTI_COLORS = [
  "#718355", // green-dark
  "#8db963", // green-mid
  "#a8d67a", // green-light
  "#cfe1b9", // green-light-mid
  "#f4d03f", // gold
  "#f39c12", // amber
  "#e74c3c", // red
  "#3498db", // blue
  "#9b59b6", // purple
];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  shape: 0 | 1 | 2; // square | circle | strip
  alpha: number;
};

function spawnParticle(width: number, height: number): Particle {
  const shapes: Particle["shape"][] = [0, 1, 2];
  return {
    x: Math.random() * width,
    y: -30 - Math.random() * height * 0.35,
    vx: (Math.random() - 0.5) * 3.2,
    vy: 1.2 + Math.random() * 3.4,
    gravity: 0.04 + Math.random() * 0.09,
    size: 6 + Math.random() * 9,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.5,
    shape: shapes[Math.floor(Math.random() * shapes.length)],
    alpha: 1,
  };
}

function ConfettiBurst({
  particleCount = 110,
  duration = 3400,
  onDone,
}: {
  particleCount?: number;
  duration?: number;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const particles = Array.from({ length: particleCount }, () => spawnParticle(width, height));
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - start) / duration;
      ctx.clearRect(0, 0, width, height);

      let alive = 0;
      for (const p of particles) {
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.alpha = Math.max(0, 1 - elapsed * 1.15);
        if (p.y > height + 40 || p.alpha <= 0) continue;
        alive += 1;

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.shape === 0) {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        } else if (p.shape === 1) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size, -p.size / 3, p.size * 2, p.size / 1.5);
        }
        ctx.restore();
      }

      if (elapsed < 1 && alive > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        doneRef.current();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [particleCount, duration]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}

type Burst = { id: number; count: number };

export function useConfetti() {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const counterRef = useRef(0);

  const fire = useCallback((particleCount = 110) => {
    counterRef.current += 1;
    const id = counterRef.current;
    setBursts((prev) => [...prev, { id, count: particleCount }]);
  }, []);

  const removeBurst = useCallback((id: number) => {
    setBursts((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const element = (
    <>
      {bursts.map((burst) => (
        <ConfettiBurst
          key={burst.id}
          particleCount={burst.count}
          onDone={() => removeBurst(burst.id)}
        />
      ))}
    </>
  );

  return { fire, element };
}