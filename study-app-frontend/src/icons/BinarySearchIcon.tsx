import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Binary Search. An arrow picks the middle cell of a sorted array; that cell fills when active. Not a magnifier.
export const BinarySearchIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="binary-search" {...props}>
    <path className="icon-fill" d="M8.7 11H15.3V20H8.7Z" fill="currentColor" stroke="none" />
    <path d="M5 11H19Q22 11 22 14V17Q22 20 19 20H5Q2 20 2 17V14Q2 11 5 11Z" />
    <path d="M8.7 11V20M15.3 11V20" />
    <g className="icon-part-arrow">
      <path d="M12 3V7.5M9.5 5.4L11.3 7.2Q12 7.9 12.7 7.2L14.5 5.4" />
    </g>
  </Icon>
));
BinarySearchIcon.displayName = "BinarySearchIcon";
