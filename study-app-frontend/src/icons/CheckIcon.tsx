import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Confirm / correct / selected. Short entry stroke into a rounded valley.
// Not Lucide Check (sharp vertex, long thin tail).
export const CheckIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="tick" {...props}>
    <path d="M5.5 12.6L9.1 16.1Q10 17 10.9 16.1L18.5 8" />
  </Icon>
));
CheckIcon.displayName = "CheckIcon";
