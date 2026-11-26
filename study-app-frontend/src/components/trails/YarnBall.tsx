/** The yarn ball Kojo chases: the finish of every path and the "+1 solved" counter. */
export function YarnBall({ size = 38, dim = false }: { size?: number; dim?: boolean }) {
  return (
    <svg
      className={`pt-yarn${dim ? " is-dim" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 38 38"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="19" cy="19" r="17" className="pt-yarn-ball" />
      <g className="pt-yarn-lines">
        <path d="M5 14c10 2 20 10 26 20" />
        <path d="M9 6c8 6 14 16 16 28" />
        <path d="M22 3c4 8 4 18 0 30" />
      </g>
    </svg>
  );
}
