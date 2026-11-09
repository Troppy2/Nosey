import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Bit Manipulation. Big 0 and 1. Static, no filled state (a filled 0 reads as a dot). Not Lucide Binary (four small glyphs).
export const BitsIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="bits" {...props}>
    <path d="M7 4H7Q10.5 4 10.5 7.5V16.5Q10.5 20 7 20H7Q3.5 20 3.5 16.5V7.5Q3.5 4 7 4Z" />
    <path d="M14.5 7.4L17.2 4.7Q17.5 4.4 17.5 4.9V20M14.5 20H20.5" />
  </Icon>
));
BitsIcon.displayName = "BitsIcon";
