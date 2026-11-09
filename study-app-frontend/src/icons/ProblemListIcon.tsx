import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode rail: Problems. A problem list with a lens over it. Not Lucide Search (lens only) or ListFilter (three bars).
export const ProblemListIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="problem-list" {...props}>
    <path d="M3 6H8.5M3 12H6.5M3 18H8.5" />
    <circle className="icon-fill" cx="15" cy="10.5" r="4.8" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10.5" r="4.8" />
    <g className="icon-part-handle">
      <path d="M18.6 14.1L21 16.5" />
    </g>
  </Icon>
));
ProblemListIcon.displayName = "ProblemListIcon";
