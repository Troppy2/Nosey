import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Menu. Three short pills, the last one shorter.
// Not Lucide Menu (three equal full-width lines).
export const MenuIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="menu" {...props}>
    <path d="M5 7H19M5 12H19" />
    <path className="icon-part-short" d="M5 17H13" />
  </Icon>
));
MenuIcon.displayName = "MenuIcon";
