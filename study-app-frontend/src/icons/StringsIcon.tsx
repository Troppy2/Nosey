import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Strings. The letters "ab": a run of characters. Static like Bits (filled letters read as blobs). Not Lucide Braces or Type (serif T).
export const StringsIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="strings" {...props}>
    <path d="M10.75 10.5V17.5M13.25 4.5V17.5" />
    <path d="M3.75 14A3.5 3.5 0 1 0 10.75 14A3.5 3.5 0 1 0 3.75 14" />
    <path d="M13.25 14A3.5 3.5 0 1 0 20.25 14A3.5 3.5 0 1 0 13.25 14" />
  </Icon>
));
StringsIcon.displayName = "StringsIcon";
