import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Add / create. Short chunky cross that sits inside the live area.
// Not Lucide Plus (14px arms edge to edge).
export const PlusIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="add" {...props}>
    <path d="M12 6.5V17.5M6.5 12H17.5" />
  </Icon>
));
PlusIcon.displayName = "PlusIcon";
