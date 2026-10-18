import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Admin / trust. Squat shield with a rounded top and a check.
// Not Lucide ShieldCheck (tall, pointed shoulders).
export const ShieldIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="shield" {...props}>
    <Cutout className="icon-part-shield" body="M11 3.4Q12 3 13 3.4L18.6 5.3Q20 5.8 20 7.3V11.5Q20 17.4 12.6 20.8Q12 21.1 11.4 20.8Q4 17.4 4 11.5V7.3Q4 5.8 5.4 5.3Z" detail="M8.8 12L11 14.1Q11.4 14.5 11.8 14.1L15.3 10.5" />
  </Icon>
));
ShieldIcon.displayName = "ShieldIcon";
