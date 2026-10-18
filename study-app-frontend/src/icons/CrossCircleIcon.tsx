import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { BADGE, Cutout } from "./Cutout";

// Wrong / failed. Squircle badge with a short cross.
// Not Lucide XCircle (perfect circle).
export const CrossCircleIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="cross-circle" {...props}>
    <Cutout body={BADGE} detail="M9.5 9.5L14.5 14.5M14.5 9.5L9.5 14.5" />
  </Icon>
));
CrossCircleIcon.displayName = "CrossCircleIcon";
