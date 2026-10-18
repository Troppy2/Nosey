import { forwardRef, type ReactNode, type SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number | string;
  title?: string;
  /** Force the filled state when there is no ARIA parent (aria-pressed etc.). */
  active?: boolean;
};

type BaseProps = IconProps & { name: string; children: ReactNode };

// The folder stats icons were drawn to fill the 24 grid. The rest of the set is
// drawn inside the live area, so it renders through a cropped viewBox (about
// 14% larger in the same box) with the stroke scaled down to stay 2px on screen.
const FULL_GRID = new Set(["tests-taken", "score-rise", "crown", "sprout"]);
const CROP = 21 / 24;

/**
 * Base for every icon in the set: 24 grid, currentColor, 2px round stroke,
 * outline at rest, filled when active. Import ./icons.css once at app root.
 */
export const Icon = forwardRef<SVGSVGElement, BaseProps>(function Icon(
  { name, size = 24, title, active, className, children, style, strokeWidth, ...rest },
  ref
) {
  const labelled = Boolean(title);
  const full = FULL_GRID.has(name);
  const stroke = strokeWidth ?? "var(--icon-stroke, 2)";
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={full ? "0 0 24 24" : "1.5 1.5 21 21"}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["icon", `icon-${name}`, className].filter(Boolean).join(" ")}
      style={{ strokeWidth: full ? stroke : `calc(${stroke} * ${CROP})`, ...style }}
      data-active={active ? "" : undefined}
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...rest}
    >
      {labelled && <title>{title}</title>}
      {children}
    </svg>
  );
});

/*
─── Worked example: cutout-style filled variant ─────────────────────────────

Squat bell (20w-ish body, pill rim, dot clapper). Filled state: body + clapper
go solid, the highlight detail becomes a cutout. Hover: body tilts 8°.

import { forwardRef, useId } from "react";
import { Icon, type IconProps } from "./Icon";

const BODY =
  "M5.64 13.09V10.44C5.64 6.94 8.5 4.08 12 4.08S18.36 6.94 18.36 10.44V13.09C18.36 15 19.1 16.16 19.63 16.69 20.27 17.33 19.84 18.39 18.89 18.39H5.11C4.16 18.39 3.73 17.33 4.37 16.69 4.9 16.16 5.64 15 5.64 13.09Z";
const DETAIL = "M8.82 9.91C8.82 8.74 9.56 7.79 10.52 7.37";

export const BellIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const mask = `m${useId().replace(/:/g, "")}`;
  return (
    <Icon ref={ref} name="bell" {...props}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d={DETAIL} stroke="black" />
      </mask>
      <g className="icon-part-body">
        <g className="icon-fill" mask={`url(#${mask})`} fill="currentColor" stroke="none">
          <path d={BODY} />
        </g>
        <path d={BODY} />
        <path className="icon-detail" d={DETAIL} />
      </g>
      <circle className="icon-fill-solid" cx="12" cy="20.8" r="1.3" />
    </Icon>
  );
});
BellIcon.displayName = "BellIcon";

Notes
- The outline <path d={BODY}/> stays visible in both states; the fill sits under it,
  so the silhouette never changes when toggling.
- icon-fill-solid: a part that is filled in BOTH states (small dots/terminals under
  ~3px read better solid). Use sparingly.
- Whole-solid icons: skip the mask and icon-detail; just add the icon-fill layer.
*/
