import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Panel action: restore the layout after maximizing. Four soft corners pointing in.
export const RestoreIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="restore" {...props}>
    <path d="M9 4V6.5Q9 9 6.5 9H4M15 4V6.5Q15 9 17.5 9H20M20 15H17.5Q15 15 15 17.5V20M4 15H6.5Q9 15 9 17.5V20" />
  </Icon>
));
RestoreIcon.displayName = "RestoreIcon";
