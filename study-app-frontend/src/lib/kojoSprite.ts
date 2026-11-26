// Kojo the cat as a pixel map, shared by the server-down runner game (canvas) and
// the Pattern Trails sprite (SVG) so the two can never drift apart.
//
// In profile, facing right: tail up and curled at the left, a rounded body, and a
// head with two ears, one eye (e), a light muzzle and belly (b) and a nose (n).
// The bottom two rows are left clear for the legs, which both renderers animate.

export const KOJO_SPRITE_COLS = 14;
export const KOJO_SPRITE_ROWS = 11;

export const KOJO_SPRITE = [
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
] as const;

/** Left column of each two-cell-wide leg pair: haunches and front legs. */
export const KOJO_LEG_COLUMNS = { back: 3, front: 7 } as const;
/** First row under the body, where the legs start. */
export const KOJO_LEG_ROW = 9;
