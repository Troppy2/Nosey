import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode rail: Drills. Three passes as three stops on a switchback. Not Lucide Route (two stops, S curve).
export const DrillsIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="drills" {...props}>
    <path d="M8.5 5H14Q18 5 18 9.5M15.5 12H10Q6 12 6 16.5" />
    <circle className="icon-fill" cx="6" cy="5" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="6" cy="5" r="2.5" />
    <circle className="icon-fill" cx="18" cy="12" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="2.5" />
    <circle className="icon-fill" cx="6" cy="19" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="6" cy="19" r="2.5" />
  </Icon>
));
DrillsIcon.displayName = "DrillsIcon";
