import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Kojo / AI assist. A plump concave star with a small companion star.
// Not Lucide Sparkles (single star plus a plus sign and dot).
export const SparklesIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="sparkles" {...props}>
    <g className="icon-fill" fill="currentColor" stroke="none">
      <path d="M10 6.5Q10.8 12.2 16.5 13.5Q10.8 14.8 10 20.5Q9.2 14.8 3.5 13.5Q9.2 12.2 10 6.5Z" />
    </g>
    <path d="M10 6.5Q10.8 12.2 16.5 13.5Q10.8 14.8 10 20.5Q9.2 14.8 3.5 13.5Q9.2 12.2 10 6.5Z" />
    <g className="icon-part-small">
      <path d="M17.5 3Q17.9 5.6 20.5 6Q17.9 6.4 17.5 9Q17.1 6.4 14.5 6Q17.1 5.6 17.5 3Z" />
    </g>
  </Icon>
));
SparklesIcon.displayName = "SparklesIcon";
