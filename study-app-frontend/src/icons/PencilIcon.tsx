import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Edit / rename. Chunky pill pencil with a ferrule seam.
// Not Lucide Pencil / Edit3 (thin shaft, sharp nib).
export const PencilIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="pencil" {...props}>
    <Cutout className="icon-part-pencil" body="M14.8 5.2Q16.6 3.4 18.4 5.2L18.8 5.6Q20.6 7.4 18.8 9.2L9.5 18.5Q9 19 8.3 19H6Q5 19 5 18V15.7Q5 15 5.5 14.5Z" detail="M13 7L17 11" />
  </Icon>
));
PencilIcon.displayName = "PencilIcon";
