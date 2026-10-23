import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// Interviewer audio. Speaker cone with one sound wave.
export const SpeakerIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="speaker" {...props}>
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M16 9a4 4 0 0 1 0 6" />
  </Icon>
));
SpeakerIcon.displayName = "SpeakerIcon";
