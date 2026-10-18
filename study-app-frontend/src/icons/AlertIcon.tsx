import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { BADGE, Cutout } from "./Cutout";

// Error / needs attention. Squircle badge, pill bar and dot.
// Not Lucide AlertCircle (perfect circle, thin long bar).
export const AlertIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="alert" {...props}>
    <Cutout body={BADGE} detail="M12 7.8V12.4M12 16.2V16.3" />
  </Icon>
));
AlertIcon.displayName = "AlertIcon";
