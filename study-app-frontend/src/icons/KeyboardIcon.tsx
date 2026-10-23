import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Switch to typed answers. Rounded keyboard with a key row and space bar.
export const KeyboardIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="keyboard" {...props}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </Icon>
));
KeyboardIcon.displayName = "KeyboardIcon";
