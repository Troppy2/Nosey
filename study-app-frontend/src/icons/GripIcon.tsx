import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Drag handle for movable tabs and panels. Six solid dots in two columns.
export const GripIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="grip" {...props}>
    <circle className="icon-fill-solid" cx="9" cy="6" r="1.4" />
    <circle className="icon-fill-solid" cx="15" cy="6" r="1.4" />
    <circle className="icon-fill-solid" cx="9" cy="12" r="1.4" />
    <circle className="icon-fill-solid" cx="15" cy="12" r="1.4" />
    <circle className="icon-fill-solid" cx="9" cy="18" r="1.4" />
    <circle className="icon-fill-solid" cx="15" cy="18" r="1.4" />
  </Icon>
));
GripIcon.displayName = "GripIcon";
