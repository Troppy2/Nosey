import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// KojoCode topic: Math. Plus, minus and equals on one card; operators cut out when filled. Not Lucide Calculator (keypad).
export const MathIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="math" {...props}>
    <Cutout body="M8 3H16Q21 3 21 8V16Q21 21 16 21H8Q3 21 3 16V8Q3 3 8 3Z" detail="M6.5 9.5H10.5M8.5 7.5V11.5 M13.5 9.5H17.5 M8 14.5H16M8 17.5H16" />
  </Icon>
));
MathIcon.displayName = "MathIcon";
