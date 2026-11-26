import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Notes tab. A squat notebook with three ring tabs on the spine and two written lines.
// Not Lucide Notebook (tall cover, square tabs, no lines).
export const NotebookIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="notebook" {...props}>
    <Cutout
      body="M9 3H17Q20 3 20 6V18Q20 21 17 21H9Q6 21 6 18V6Q6 3 9 3Z"
      detail="M10.5 8.5H15.5M10.5 12.5H14"
    />
    <path d="M4 8H7M4 12H7M4 16H7" />
  </Icon>
));
NotebookIcon.displayName = "NotebookIcon";
