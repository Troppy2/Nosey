import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Microphone for voice answers. Pill capsule on a rounded stand.
export const MicIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="mic" {...props}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
));
MicIcon.displayName = "MicIcon";
