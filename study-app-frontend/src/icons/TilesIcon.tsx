import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode rail: Dashboard. Three roomy tiles, one tall. Not Lucide Layers3 (stacked rhombi) or LayoutDashboard (4 rx2 tiles).
export const TilesIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="tiles" {...props}>
    <path className="icon-fill" d="M6 3H8Q11 3 11 6V9Q11 12 8 12H6Q3 12 3 9V6Q3 3 6 3Z" fill="currentColor" stroke="none" />
    <path d="M6 3H8Q11 3 11 6V9Q11 12 8 12H6Q3 12 3 9V6Q3 3 6 3Z" />
    <path className="icon-fill" d="M6 15H8Q11 15 11 18V18Q11 21 8 21H6Q3 21 3 18V18Q3 15 6 15Z" fill="currentColor" stroke="none" />
    <path d="M6 15H8Q11 15 11 18V18Q11 21 8 21H6Q3 21 3 18V18Q3 15 6 15Z" />
    <path className="icon-fill" d="M17 3H18Q21 3 21 6V18Q21 21 18 21H17Q14 21 14 18V6Q14 3 17 3Z" fill="currentColor" stroke="none" />
    <path d="M17 3H18Q21 3 21 6V18Q21 21 18 21H17Q14 21 14 18V6Q14 3 17 3Z" />
  </Icon>
));
TilesIcon.displayName = "TilesIcon";
