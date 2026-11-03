import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// A simple calendar grid: header bar + 7 rows of days.
// Drawn outline at rest, filled when active.
export const CalendarIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="calendar" {...props}>
    <rect x="2" y="3" width="20" height="19" rx="3" />
    <path d="M2 6h20M12 3v3" />
  </Icon>
));
CalendarIcon.displayName = "CalendarIcon";
