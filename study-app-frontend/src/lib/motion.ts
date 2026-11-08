/** Fast-out, gentle-settle easing for layout moves (cards sliding into place). */
export const EASE_SETTLE = "cubic-bezier(0.2, 0, 0, 1)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
