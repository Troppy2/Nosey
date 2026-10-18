import { useId } from "react";

/**
 * Cutout-style fill shared by the set: the body fills when active and the
 * detail strokes are knocked out of it, so they read as holes.
 */
export function Cutout({ body, detail, className }: { body: string; detail: string; className?: string }) {
  const mask = `m${useId().replace(/:/g, "")}`;
  return (
    <g className={className}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d={detail} stroke="black" />
      </mask>
      <g className="icon-fill" mask={`url(#${mask})`} fill="currentColor" stroke="none">
        <path d={body} />
      </g>
      <path d={body} />
      <path className="icon-detail" d={detail} />
    </g>
  );
}

/** Soft squircle badge used by the status family (success, wrong, alert, info). */
export const BADGE =
  "M10 3H14C18.5 3 21 5.5 21 10V14C21 18.5 18.5 21 14 21H10C5.5 21 3 18.5 3 14V10C3 5.5 5.5 3 10 3Z";
