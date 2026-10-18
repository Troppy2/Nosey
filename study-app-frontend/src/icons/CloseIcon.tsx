import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Close / dismiss / remove. Two gently bowed, shorter strokes.
// Not Lucide X (straight full-width diagonals).
export const CloseIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="close" {...props}>
    <path d="M7.5 7.5C10.2 10 13.8 14 16.5 16.5M16.5 7.5C14 10.2 10 13.8 7.5 16.5" />
  </Icon>
));
CloseIcon.displayName = "CloseIcon";
