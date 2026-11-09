import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Backtracking. Go out, turn around, come back: a U-turn from a start point. Not Lucide Undo2 / RotateCcw.
export const BacktrackIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="backtrack" {...props}>
    <path d="M6 16.5V10Q6 4.5 12 4.5Q18 4.5 18 10V15.5" />
    <g className="icon-part-head">
      <path d="M15.2 13.2L17.3 15.6Q18 16.4 18.7 15.6L20.8 13.2" />
    </g>
    <circle className="icon-fill" cx="6" cy="19" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="6" cy="19" r="2.5" />
  </Icon>
));
BacktrackIcon.displayName = "BacktrackIcon";
