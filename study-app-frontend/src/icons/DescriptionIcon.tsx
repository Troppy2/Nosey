import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Problem statement tab. A plump page with a soft folded corner and two text lines.
// Not Lucide FileText (sharp fold, three equal lines).
export const DescriptionIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="description" {...props}>
    <Cutout
      body="M8 3H13.6Q14.4 3 15 3.6L18.4 7Q19 7.6 19 8.4V18Q19 21 16 21H8Q5 21 5 18V6Q5 3 8 3Z"
      detail="M14 3.6V6.5Q14 8.5 16 8.5H18.6M9 13H15M9 16.8H12.8"
    />
  </Icon>
));
DescriptionIcon.displayName = "DescriptionIcon";
