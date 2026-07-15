import { useEffect, useState } from 'react';

interface KojoMascotProps {
  state?: 'idle' | 'loading' | 'error';
  size?: number;
  className?: string;
}

/**
 * Kojo mascot icon.
 * - idle: ambient blink loop
 * - loading: eyes hidden, glasses + laptop fade in, laptop lines pulse to
 *   simulate typing while waiting on a response
 * - error: eyes and mouth swap to an angry brow + frown, brief shake on entry
 *
 * Drop <KojoMascot state={isWaiting ? 'loading' : 'idle'} /> anywhere the
 * old static icon was used. currentColor drives the stroke, so wrap it in
 * an element with the desired ink color (e.g. color: var(--green-dark)).
 *
 * Size is standardized: leave `size` alone unless the mascot is a hero
 * illustration rather than an icon. Stroke width is in viewBox units, so it
 * scales with `size`; a smaller mascot reads thinner, which is why every icon
 * usage takes the same default.
 */
export default function KojoMascot({ state = 'idle', size = 38, className }: KojoMascotProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const loading = state === 'loading';
  const error = state === 'error';

  return (
    <svg
      viewBox="0 0 360 320"
      width={size}
      height={(size * 320) / 360}
      role="img"
      aria-label={loading ? 'Kojo is working on a response' : error ? 'Kojo hit an error' : 'Kojo'}
      className={className}
      style={error && !reducedMotion ? { animation: 'kojo-shake 0.4s' } : undefined}
    >
      <g
        stroke="currentColor"
        strokeWidth={18}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M85 135 L100 45 L145 115" />
        <path d="M215 115 L260 45 L275 135" />
        <path d="M145 115 C155 100, 205 100, 215 115" />
        <path d="M85 135 C55 150, 50 190, 60 215 C68 235, 90 245, 110 240" />
        <path d="M275 135 C305 150, 310 190, 300 215 C292 235, 270 245, 250 240" />

        <g opacity={loading || error ? 0 : 1} style={{ transition: 'opacity 0.25s' }}>
          <line
            x1={150} y1={150} x2={150} y2={176}
            className={!reducedMotion ? 'kojo-blink' : undefined}
            style={{ animationDelay: '0s' }}
          />
          <line
            x1={210} y1={150} x2={210} y2={176}
            className={!reducedMotion ? 'kojo-blink' : undefined}
            style={{ animationDelay: '0.05s' }}
          />
        </g>

        <g opacity={error ? 1 : 0} style={{ transition: 'opacity 0.25s' }}>
          <line x1={140} y1={150} x2={160} y2={168} />
          <line x1={220} y1={150} x2={200} y2={168} />
          <line x1={128} y1={126} x2={160} y2={142} />
          <line x1={232} y1={126} x2={200} y2={142} />
        </g>

        <path d="M145 205 L165 225 L195 195" opacity={error ? 0 : 1} style={{ transition: 'opacity 0.25s' }} />
        <path d="M142 218 Q165 192 198 218" opacity={error ? 1 : 0} style={{ transition: 'opacity 0.25s' }} />
      </g>

      <g
        stroke="currentColor"
        strokeWidth={13}
        strokeLinecap="round"
        fill="none"
        opacity={loading ? 1 : 0}
        style={{ transition: 'opacity 0.3s' }}
      >
        <circle cx={150} cy={163} r={24} />
        <circle cx={210} cy={163} r={24} />
        <line x1={174} y1={163} x2={186} y2={163} />
        <line x1={126} y1={158} x2={102} y2={148} />
        <line x1={234} y1={158} x2={258} y2={148} />
      </g>

      <g opacity={loading ? 1 : 0} style={{ transition: 'opacity 0.3s' }}>
        <rect x={130} y={215} width={100} height={60} rx={4} fill="var(--surface-2, #fff)" stroke="currentColor" strokeWidth={13} />
        <line x1={145} y1={232} x2={185} y2={232} stroke="currentColor" strokeWidth={9} strokeLinecap="round" className={loading && !reducedMotion ? 'kojo-type' : undefined} style={{ animationDelay: '0s' }} />
        <line x1={145} y1={245} x2={200} y2={245} stroke="currentColor" strokeWidth={9} strokeLinecap="round" className={loading && !reducedMotion ? 'kojo-type' : undefined} style={{ animationDelay: '0.2s' }} />
        <line x1={145} y1={258} x2={175} y2={258} stroke="currentColor" strokeWidth={9} strokeLinecap="round" className={loading && !reducedMotion ? 'kojo-type' : undefined} style={{ animationDelay: '0.4s' }} />
        <path d="M118 285 L242 285 L228 300 L132 300 Z" fill="var(--surface-1, #f2f2f0)" stroke="currentColor" strokeWidth={13} strokeLinejoin="round" />
      </g>

      <style>{`
        @keyframes kojo-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          96% { transform: scaleY(0.08); }
        }
        .kojo-blink {
          transform-box: fill-box;
          transform-origin: center;
          animation: kojo-blink 4.5s infinite;
        }
        @keyframes kojo-type {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.15; }
        }
        .kojo-type {
          animation: kojo-type 1.2s infinite;
        }
        @keyframes kojo-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(3px); }
        }
      `}</style>
    </svg>
  );
}
