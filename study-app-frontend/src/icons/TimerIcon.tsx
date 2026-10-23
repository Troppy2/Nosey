import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Countdown clock with a top button.
export const TimerIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="timer" {...props}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2M9 2h6" />
  </Icon>
));
TimerIcon.displayName = "TimerIcon";
