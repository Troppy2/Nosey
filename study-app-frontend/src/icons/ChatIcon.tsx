import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Kojo chat. Round bubble with two text lines and a short tail.
// Not Lucide MessageCircle (perfect circle, no dots).
export const ChatIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="chat" {...props}>
    <Cutout className="icon-part-bubble" body="M12 4C16.7 4 20.5 7 20.5 10.8S16.7 17.6 12 17.6Q10.9 17.6 9.9 17.4L6.4 19.6Q5.4 20.2 5.5 19L5.8 16Q3.5 14 3.5 10.8C3.5 7 7.3 4 12 4Z" detail="M8.5 9.5H15.5M8.5 12.6H12.5" />
  </Icon>
));
ChatIcon.displayName = "ChatIcon";
