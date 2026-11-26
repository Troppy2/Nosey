import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Pattern trails entry (KojoCode header button). A winding path from a solid start dot
// up to a small flag on its own pole (option B, picked by the user 2026-11-25).
// The flag fills when active and waves on hover. Not Lucide Route (two pins, no flag).
const FLAG = "M17 3.8H21.1Q21.7 3.8 21.4 4.3L20.5 5.4L21.4 6.5Q21.7 7 21.1 7H17Z";
export const TrailIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="trail" {...props}>
    <circle className="icon-fill-solid" cx="5" cy="19" r="1.8" />
    <path d="M7.6 19H13Q16.5 19 16.5 15.75Q16.5 12.5 13 12.5H11Q7.5 12.5 7.5 9.25Q7.5 6 11 6H13.5" />
    <path d="M17 10V3.5" />
    <g className="icon-part-flag">
      <path className="icon-fill" d={FLAG} fill="currentColor" stroke="none" />
      <path d={FLAG} />
    </g>
  </Icon>
));
TrailIcon.displayName = "TrailIcon";
