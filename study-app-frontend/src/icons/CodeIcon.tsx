import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Code / KojoCode. Rounded angle brackets around a short slash. No filled state.
// Not Lucide Code2 (sharp brackets, long slash).
export const CodeIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="code" {...props}>
    <path className="icon-part-left" d="M8 8L4.9 11.1Q4 12 4.9 12.9L8 16" />
    <path className="icon-part-right" d="M16 8L19.1 11.1Q20 12 19.1 12.9L16 16" />
    <path d="M13.2 7.5L10.8 16.5" />
  </Icon>
));
CodeIcon.displayName = "CodeIcon";
