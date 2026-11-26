import { forwardRef, useId } from "react";
import { Icon, type IconProps } from "./Icon";

const BODY = "M3.5 16A8.5 8.5 0 0 1 20.5 16Q20.5 19 17.5 19H6.5Q3.5 19 3.5 16Z";
const NEEDLE = "M12 15.5L15.6 10.6";

// Complexity check tab. A plump half gauge with a needle; the needle swings a little on hover.
// Not Lucide Gauge (full circle outline, tick marks).
export const ComplexityIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const mask = `m${useId().replace(/:/g, "")}`;
  return (
    <Icon ref={ref} name="complexity" {...props}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d={NEEDLE} stroke="black" />
      </mask>
      <g className="icon-fill" mask={`url(#${mask})`} fill="currentColor" stroke="none">
        <path d={BODY} />
      </g>
      <path d={BODY} />
      <path className="icon-detail icon-part-needle" d={NEEDLE} />
    </Icon>
  );
});
ComplexityIcon.displayName = "ComplexityIcon";
