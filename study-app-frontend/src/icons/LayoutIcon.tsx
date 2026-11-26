import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Layout menu (reset or choose a panel layout). A rounded window split into a tall left
// panel and two stacked right panels, matching the editor's default dock.
export const LayoutIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="layout" {...props}>
    <Cutout
      body="M6 4H18Q21 4 21 7V17Q21 20 18 20H6Q3 20 3 17V7Q3 4 6 4Z"
      detail="M10 4V20M10 13.5H21"
    />
  </Icon>
));
LayoutIcon.displayName = "LayoutIcon";
