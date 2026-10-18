import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Search. Big round lens with a short stubby handle.
// Not Lucide Search (smaller lens, long handle into the corner).
export const SearchIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="lens" {...props}>
    <g className="icon-part-lens">
      <circle className="icon-fill" cx="10.5" cy="10.5" r="6.5" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.6 15.6L19 19" />
    </g>
  </Icon>
));
SearchIcon.displayName = "SearchIcon";
