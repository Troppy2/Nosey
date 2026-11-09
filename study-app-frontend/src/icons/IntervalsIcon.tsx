import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Intervals. Two closed ranges with endpoints, overlapping in the middle. Replaces a duplicate PanelRightOpen.
export const IntervalsIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="intervals" {...props}>
    <path d="M6.5 8H11.5M12.5 16H17.5" />
    <circle className="icon-fill" cx="4.5" cy="8" r="2" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="8" r="2" />
    <circle className="icon-fill" cx="13.5" cy="8" r="2" fill="currentColor" stroke="none" />
    <circle cx="13.5" cy="8" r="2" />
    <circle className="icon-fill" cx="10.5" cy="16" r="2" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="16" r="2" />
    <circle className="icon-fill" cx="19.5" cy="16" r="2" fill="currentColor" stroke="none" />
    <circle cx="19.5" cy="16" r="2" />
  </Icon>
));
IntervalsIcon.displayName = "IntervalsIcon";
