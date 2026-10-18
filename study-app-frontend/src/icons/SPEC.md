# Icon set spec (default: soft & friendly)

Copy to `src/icons/SPEC.md` in a project. Edit to override; unmentioned lines stay default.

## Grid
- 24×24 viewBox, live area 2–22

## Color
- currentColor only, no tints, gradients or accent colors
- Rest: outline (`fill="none"`)
- Active: solid fill (per-icon style: whole / cutouts / partial)

## Stroke
- Width: 2 (`--icon-stroke: 2`)
- Caps: round · Joins: round

## Shape language
- Blended: big radii + squat/plump proportions + built from circles & pills
- Rect radius: 4 (shapes ≥14px), 3 (8–14px), pill (<8px)
- No internal corner sharper than a 1.5px radius
- See references/shape-language.md

## Motion
- Hover/focus: one subtle nudge per icon (≤1.5px translate or ≤10° rotate), 160ms
- Active: fill in over 200ms; details fade out over the same 200ms
- Easing: cubic-bezier(0.3, 0, 0, 1)
- No keyframes, bounces, loops, or pops
- Reduced motion: state changes are instant

## Overrides for this project
(none)
