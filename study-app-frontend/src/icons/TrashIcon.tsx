import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Delete. Squat bowed bin, pill lid with a rounded handle.
// Not Lucide Trash2 (tall tapered can, thin lid).
export const TrashIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="trash" {...props}>
    <Cutout body="M6 9.5H18L17.3 17.6Q17.1 20 14.7 20H9.3Q6.9 20 6.7 17.6Z" detail="M10.5 12.5V16.5M13.5 12.5V16.5" />
    <g className="icon-part-lid">
      <path d="M4.5 6.5H19.5" />
      <path d="M9.5 6.5V6Q9.5 4 11.5 4H12.5Q14.5 4 14.5 6V6.5" />
    </g>
  </Icon>
));
TrashIcon.displayName = "TrashIcon";
