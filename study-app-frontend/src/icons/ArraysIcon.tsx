import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// KojoCode topic: Arrays. One pill split into three cells. Not Lucide Columns3 (square, tall).
export const ArraysIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="arrays" {...props}>
    <Cutout body="M5.5 7H18.5Q22 7 22 10.5V13.5Q22 17 18.5 17H5.5Q2 17 2 13.5V10.5Q2 7 5.5 7Z" detail="M8.7 7V17 M15.3 7V17" />
  </Icon>
));
ArraysIcon.displayName = "ArraysIcon";
