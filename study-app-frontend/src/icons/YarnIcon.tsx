import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// The yarn ball Kojo chases: a finished path and "+1 solved". Round ball with two
// curved wraps and a loose tail of thread. The ball rolls a little on hover.
export const YarnIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="yarn" {...props}>
    <Cutout
      className="icon-part-ball"
      body="M11.5 3.5A8 8 0 1 1 11.49 3.5Z"
      detail="M4.8 9.6Q10.8 10 15.3 17.8M13.4 3.8Q16.9 8.8 16.2 17.4"
    />
    <path d="M17.6 17.4Q19.6 19.6 21.5 19" />
  </Icon>
));
YarnIcon.displayName = "YarnIcon";
