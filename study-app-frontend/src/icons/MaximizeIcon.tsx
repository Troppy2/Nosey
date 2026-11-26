import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Panel action: maximize. Four soft corners pointing out. Pairs with RestoreIcon.
export const MaximizeIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="maximize" {...props}>
    <path d="M4 9V6.5Q4 4 6.5 4H9M15 4H17.5Q20 4 20 6.5V9M20 15V17.5Q20 20 17.5 20H15M9 20H6.5Q4 20 4 17.5V15" />
  </Icon>
));
MaximizeIcon.displayName = "MaximizeIcon";
