import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Linked List. Two plump nodes joined by a pointer. Not Lucide Link2 (chain links).
export const LinkedListIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="linked-list" {...props}>
    <path d="M9.5 12H14.5" />
    <path className="icon-fill" d="M5 7H6.5Q9.5 7 9.5 10V14Q9.5 17 6.5 17H5Q2 17 2 14V10Q2 7 5 7Z" fill="currentColor" stroke="none" />
    <path d="M5 7H6.5Q9.5 7 9.5 10V14Q9.5 17 6.5 17H5Q2 17 2 14V10Q2 7 5 7Z" />
    <path className="icon-fill" d="M17.5 7H19Q22 7 22 10V14Q22 17 19 17H17.5Q14.5 17 14.5 14V10Q14.5 7 17.5 7Z" fill="currentColor" stroke="none" />
    <path d="M17.5 7H19Q22 7 22 10V14Q22 17 19 17H17.5Q14.5 17 14.5 14V10Q14.5 7 17.5 7Z" />
  </Icon>
));
LinkedListIcon.displayName = "LinkedListIcon";
