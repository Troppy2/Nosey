import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Extra. A puzzle piece: extra pieces beyond the core path. Replaces a duplicate Trophy (same as Advanced).
export const PuzzleIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="puzzle" {...props}>
    <path className="icon-fill" d="M6 7H7.7A2.6 2.6 0 1 1 12.3 7H14Q17 7 17 10V11.7A2.6 2.6 0 1 1 17 16.3V18Q17 21 14 21H6Q3 21 3 18V10Q3 7 6 7Z" fill="currentColor" stroke="none" />
    <path d="M6 7H7.7A2.6 2.6 0 1 1 12.3 7H14Q17 7 17 10V11.7A2.6 2.6 0 1 1 17 16.3V18Q17 21 14 21H6Q3 21 3 18V10Q3 7 6 7Z" />
  </Icon>
));
PuzzleIcon.displayName = "PuzzleIcon";
