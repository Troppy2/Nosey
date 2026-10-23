import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Run tests / play audio. Solid rounded triangle.
export const PlayIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="play" {...props}>
    <path d="M7 5v14l12-7z" fill="currentColor" />
  </Icon>
));
PlayIcon.displayName = "PlayIcon";
