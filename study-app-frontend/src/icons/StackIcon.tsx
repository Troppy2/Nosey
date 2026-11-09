import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Stack. Three trays, narrowest on top: last in, first out. Hover: the top tray lifts. Not Lucide Layers3 (rhombi).
export const StackIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="stack" {...props}>
    <g className="icon-part-top">
      <path className="icon-fill" d="M7.75 3.25H16.25Q18 3.25 18 5V5Q18 6.75 16.25 6.75H7.75Q6 6.75 6 5V5Q6 3.25 7.75 3.25Z" fill="currentColor" stroke="none" />
      <path d="M7.75 3.25H16.25Q18 3.25 18 5V5Q18 6.75 16.25 6.75H7.75Q6 6.75 6 5V5Q6 3.25 7.75 3.25Z" />
    </g>
    <path className="icon-fill" d="M5.75 10.25H18.25Q20 10.25 20 12V12Q20 13.75 18.25 13.75H5.75Q4 13.75 4 12V12Q4 10.25 5.75 10.25Z" fill="currentColor" stroke="none" />
    <path d="M5.75 10.25H18.25Q20 10.25 20 12V12Q20 13.75 18.25 13.75H5.75Q4 13.75 4 12V12Q4 10.25 5.75 10.25Z" />
    <path className="icon-fill" d="M4.75 17.25H19.25Q21 17.25 21 19V19Q21 20.75 19.25 20.75H4.75Q3 20.75 3 19V19Q3 17.25 4.75 17.25Z" fill="currentColor" stroke="none" />
    <path d="M4.75 17.25H19.25Q21 17.25 21 19V19Q21 20.75 19.25 20.75H4.75Q3 20.75 3 19V19Q3 17.25 4.75 17.25Z" />
  </Icon>
));
StackIcon.displayName = "StackIcon";
