import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Submissions tab. A clock face whose rim turns back on itself with a soft arrow.
// Outline only, like TimerIcon: an open arc has no body to fill.
export const HistoryIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="history" {...props}>
    <g className="icon-part-loop">
      <path d="M4.5 12A7.5 7.5 0 1 0 6.7 6.7" />
      <path d="M4.4 4.6V8.2H8" />
    </g>
    <path d="M12 8.3V12L14.6 13.7" />
  </Icon>
));
HistoryIcon.displayName = "HistoryIcon";
