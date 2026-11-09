import { forwardRef, useId } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Sliding Window. A window framing part of an array; the window fills when active and slides on hover. Not Lucide Route.
export const SlidingWindowIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const mask = `m${useId().replace(/:/g, "")}`;
  return (
    <Icon ref={ref} name="sliding-window" {...props}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d="M10.5 4H13.5Q17 4 17 7.5V16.5Q17 20 13.5 20H10.5Q7 20 7 16.5V7.5Q7 4 10.5 4Z" fill="black" stroke="black" />
      </mask>
      <path d="M5 8H19Q22 8 22 11V13Q22 16 19 16H5Q2 16 2 13V11Q2 8 5 8Z" mask={`url(#${mask})`} />
      <g className="icon-part-window">
        <path className="icon-fill" d="M10.5 4H13.5Q17 4 17 7.5V16.5Q17 20 13.5 20H10.5Q7 20 7 16.5V7.5Q7 4 10.5 4Z" fill="currentColor" stroke="none" />
        <path d="M10.5 4H13.5Q17 4 17 7.5V16.5Q17 20 13.5 20H10.5Q7 20 7 16.5V7.5Q7 4 10.5 4Z" />
      </g>
    </Icon>
  );
});
SlidingWindowIcon.displayName = "SlidingWindowIcon";
