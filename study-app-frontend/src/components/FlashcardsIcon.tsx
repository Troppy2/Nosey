import type { SVGProps } from "react";

interface FlashcardsIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/** Stacked flashcards using Nosey's paper, ink, and green palette. */
export function FlashcardsIcon({ size = 26, ...props }: FlashcardsIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 40"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {/* Rear card: a muted Nosey-green edge, replacing the reference's black shadow. */}
      <path
        d="M10 12.5h27a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4V16.5a4 4 0 0 1 1-4Z"
        fill="var(--green-light)"
        stroke="var(--green-dark)"
        strokeWidth="1.7"
      />

      {/* Front card: white paper with dark-ink prompt lines. */}
      <g transform="rotate(-9 23 18)">
        <rect
          x="6"
          y="5"
          width="32"
          height="24"
          rx="4.5"
          fill="var(--white)"
          stroke="var(--green-dark)"
          strokeWidth="1.7"
        />
        <path d="M12 12h18M12 17h13M12 22h19" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export default FlashcardsIcon;
