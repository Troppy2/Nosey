import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Dynamic Programming. A memo table: small solved cells feed the big answer cell, which fills when active. Not Lucide Table (3x3, rx2).
export const DpTableIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="dp-table" {...props}>
    <path className="icon-fill" d="M10 10H21V17Q21 21 17 21H10Z" fill="currentColor" stroke="none" />
    <path d="M7 3H17Q21 3 21 7V17Q21 21 17 21H7Q3 21 3 17V7Q3 3 7 3Z" />
    <path d="M3 10H21M10 3V21" />
  </Icon>
));
DpTableIcon.displayName = "DpTableIcon";
