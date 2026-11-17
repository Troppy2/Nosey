import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Focused practice, a static target with an arrow.
export const DrillsIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="drills" {...props}>
    <path d="M12 3A9 9 0 1 0 21 12M12 7A5 5 0 1 0 17 12" />
    <circle className="icon-fill" cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.8" />
    <path d="M15.5 8.5L21 3M17 3H21V7" />
  </Icon>
));
DrillsIcon.displayName = "DrillsIcon";
