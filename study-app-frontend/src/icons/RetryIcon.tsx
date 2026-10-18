import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Retry / redo / reset. Round loop with a rounded L head at upper left.
// Not Lucide RotateCcw (open 3/4 arc that trails off the top).
export const RetryIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="retry" {...props}>
    <g className="icon-part-loop">
      <path d="M6.7 6.7A7.5 7.5 0 1 1 4.5 12" />
      <path d="M4.5 4.5V7.6Q4.5 8.6 5.5 8.6H8.6" />
    </g>
  </Icon>
));
RetryIcon.displayName = "RetryIcon";
