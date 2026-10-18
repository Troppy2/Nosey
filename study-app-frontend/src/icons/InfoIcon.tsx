import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { BADGE, Cutout } from "./Cutout";

// Info / hint. Squircle badge, dot over a pill bar.
// Not Lucide Info (perfect circle).
export const InfoIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="info" {...props}>
    <Cutout body={BADGE} detail="M12 11.6V16.2M12 7.8V7.9" />
  </Icon>
));
InfoIcon.displayName = "InfoIcon";
