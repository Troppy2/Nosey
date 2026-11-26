import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Solutions tab (Kojo's walkthrough of each approach). A round bulb on a short neck,
// with a pill base and a curved shine. Not Lucide Lightbulb (tall narrow glass, flat base).
export const SolutionsIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="solutions" {...props}>
    <Cutout
      body="M12 3C15.6 3 18.5 5.8 18.5 9.3C18.5 11.6 17.3 13.3 15.8 14.6Q15 15.3 15 16.4V17H9V16.4Q9 15.3 8.2 14.6C6.7 13.3 5.5 11.6 5.5 9.3C5.5 5.8 8.4 3 12 3Z"
      detail="M9.3 9Q9.7 6.9 11.8 6.3"
    />
    <path d="M9.6 20.5H14.4" />
  </Icon>
));
SolutionsIcon.displayName = "SolutionsIcon";
