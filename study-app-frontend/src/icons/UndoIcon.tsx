import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Undo / resume. Rounded head pointing back on a U-turn tail.
// Not Lucide Undo2 (sharp head, thin tail).
export const UndoIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="undo" {...props}>
    <path d="M8.5 5.5L5.2 8.8Q4.5 9.5 5.2 10.2L8.5 13.5" />
    <path d="M5 9.5H14.5Q19.5 9.5 19.5 14Q19.5 18.5 14.5 18.5H11" />
  </Icon>
));
UndoIcon.displayName = "UndoIcon";
