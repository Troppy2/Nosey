import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Upload. Rounded-head arrow lifting out of a pill tray.
// Not Lucide Upload (sharp head, square open box).
export const UploadIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="upload" {...props}>
    <g className="icon-part-arrow">
      <path d="M12 15V5.5" />
      <path d="M8 9L11.3 5.7Q12 5 12.7 5.7L16 9" />
    </g>
    <path d="M4 14.5V16Q4 20 8 20H16Q20 20 20 16V14.5" />
  </Icon>
));
UploadIcon.displayName = "UploadIcon";
