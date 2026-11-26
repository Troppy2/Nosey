import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Test result tab (run output). A rounded window with a prompt chevron and a cursor line.
// Not Lucide SquareTerminal (square frame, thin chevron).
export const TerminalIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="terminal" {...props}>
    <Cutout
      body="M6 4H18Q21 4 21 7V17Q21 20 18 20H6Q3 20 3 17V7Q3 4 6 4Z"
      detail="M7.2 9.4L10 12L7.2 14.6M12.6 15H16.6"
    />
  </Icon>
));
TerminalIcon.displayName = "TerminalIcon";
