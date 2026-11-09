import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode rail: Practice. A chunky level dumbbell: training weak spots. Not Lucide Dumbbell (diagonal, thin plates).
export const DumbbellIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="dumbbell" {...props}>
    <g className="icon-part-bell">
      <path d="M8.5 12H15.5" />
      <path className="icon-fill" d="M7 6H7Q9 6 9 8V16Q9 18 7 18H7Q5 18 5 16V8Q5 6 7 6Z" fill="currentColor" stroke="none" />
      <path d="M7 6H7Q9 6 9 8V16Q9 18 7 18H7Q5 18 5 16V8Q5 6 7 6Z" />
      <path className="icon-fill" d="M17 6H17Q19 6 19 8V16Q19 18 17 18H17Q15 18 15 16V8Q15 6 17 6Z" fill="currentColor" stroke="none" />
      <path d="M17 6H17Q19 6 19 8V16Q19 18 17 18H17Q15 18 15 16V8Q15 6 17 6Z" />
      <path className="icon-fill" d="M3.5 9H3.5Q5 9 5 10.5V13.5Q5 15 3.5 15H3.5Q2 15 2 13.5V10.5Q2 9 3.5 9Z" fill="currentColor" stroke="none" />
      <path d="M3.5 9H3.5Q5 9 5 10.5V13.5Q5 15 3.5 15H3.5Q2 15 2 13.5V10.5Q2 9 3.5 9Z" />
      <path className="icon-fill" d="M20.5 9H20.5Q22 9 22 10.5V13.5Q22 15 20.5 15H20.5Q19 15 19 13.5V10.5Q19 9 20.5 9Z" fill="currentColor" stroke="none" />
      <path d="M20.5 9H20.5Q22 9 22 10.5V13.5Q22 15 20.5 15H20.5Q19 15 19 13.5V10.5Q19 9 20.5 9Z" />
    </g>
  </Icon>
));
DumbbellIcon.displayName = "DumbbellIcon";
