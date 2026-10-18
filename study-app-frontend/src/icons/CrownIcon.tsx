import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Mastered topic: a squat crown with rounded valleys, dot finials and a pill band.
// Not Lucide's Crown (sharp spikes, no finials, band drawn as part of the body).
const BODY =
  "M5.2 17.5Q4.2 17.5 4.1 16.5L3.4 10.4Q3.3 9.2 4.3 9.9L7.6 12.1Q8.4 12.6 8.9 11.8L11.1 7.9Q12 6.4 12.9 7.9L15.1 11.8Q15.6 12.6 16.4 12.1L19.7 9.9Q20.7 9.2 20.6 10.4L19.9 16.5Q19.8 17.5 18.8 17.5Z";

export const CrownIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="crown" {...props}>
    <g className="icon-part-crown">
      <g className="icon-fill" fill="currentColor" stroke="none">
        <path d={BODY} />
      </g>
      <path d={BODY} />
      <circle className="icon-fill-solid" cx="12" cy="4.2" r="1.3" />
      <circle className="icon-fill-solid" cx="3.4" cy="7" r="1.2" />
      <circle className="icon-fill-solid" cx="20.6" cy="7" r="1.2" />
    </g>
    <path d="M6.5 20.5H17.5" />
  </Icon>
));
CrownIcon.displayName = "CrownIcon";
