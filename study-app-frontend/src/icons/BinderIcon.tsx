import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// KojoCode rail: Prep Banks. A plump binder: spine plus two saved entries; they cut out when filled. Not Lucide Book/Notebook (tall, rx2).
export const BinderIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="binder" {...props}>
    <Cutout body="M7 3.5H17Q21 3.5 21 7.5V16.5Q21 20.5 17 20.5H7Q3 20.5 3 16.5V7.5Q3 3.5 7 3.5Z" detail="M8.5 3.5V20.5 M12.5 9.5H17 M12.5 14.5H15.5" />
  </Icon>
));
BinderIcon.displayName = "BinderIcon";
