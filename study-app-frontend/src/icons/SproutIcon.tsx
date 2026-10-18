import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Weak topic, framed as "still growing": a seedling with two round leaves in a squat pot.
// Not Lucide's Sprout (no pot, pointed curled leaves on a long stem).
const POT = "M4.6 15H19.4Q20.4 15 20.1 16L19.1 19.4Q18.6 21 17 21H7Q5.4 21 4.9 19.4L3.9 16Q3.6 15 4.6 15Z";

export const SproutIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="sprout" {...props}>
    <path d={POT} />
    <path d="M12 15V8" />
    <g className="icon-part-leaves">
      <g className="icon-fill" fill="currentColor" stroke="none">
        <ellipse cx="8.6" cy="8.8" rx="3.3" ry="2.1" transform="rotate(30 8.6 8.8)" />
        <ellipse cx="15.4" cy="6.6" rx="3.3" ry="2.1" transform="rotate(-30 15.4 6.6)" />
      </g>
      <ellipse cx="8.6" cy="8.8" rx="3.3" ry="2.1" transform="rotate(30 8.6 8.8)" />
      <ellipse cx="15.4" cy="6.6" rx="3.3" ry="2.1" transform="rotate(-30 15.4 6.6)" />
    </g>
  </Icon>
));
SproutIcon.displayName = "SproutIcon";
