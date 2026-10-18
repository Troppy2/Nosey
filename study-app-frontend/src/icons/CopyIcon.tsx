import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Copy. Front card with rx 4 over the corner of a back card.
// Not Lucide Copy (two full rx 2 squares).
export const CopyIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="copy" {...props}>
    <g className="icon-fill" fill="currentColor" stroke="none">
      <rect x="8.5" y="8.5" width="12.5" height="12.5" rx="4" />
    </g>
    <rect x="8.5" y="8.5" width="12.5" height="12.5" rx="4" />
    <path className="icon-part-back" d="M5 15.5Q3 15.5 3 13V7Q3 3 7 3H13Q15.5 3 15.5 5" />
  </Icon>
));
CopyIcon.displayName = "CopyIcon";
