import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { BADGE, Cutout } from "./Cutout";

// Success / done. Check inside the soft squircle badge shared by the status family.
// Not Lucide CheckCircle2 (perfect circle, sharp check).
export const CheckCircleIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="check-circle" {...props}>
    <Cutout body={BADGE} detail="M8.5 12.3L10.6 14.3Q11.1 14.8 11.6 14.3L15.5 10" />
  </Icon>
));
CheckCircleIcon.displayName = "CheckCircleIcon";
