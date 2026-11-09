import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// KojoCode topic: Custom Questions. A wide code window; brackets cut out when filled. Not Lucide SquareCode (square, rx2).
export const CodeWindowIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="code-window" {...props}>
    <Cutout body="M7 4H17Q22 4 22 9V15Q22 20 17 20H7Q2 20 2 15V9Q2 4 7 4Z" detail="M9.5 9L7.4 11.1Q6.6 12 7.4 12.9L9.5 15 M14.5 9L16.6 11.1Q17.4 12 16.6 12.9L14.5 15" />
  </Icon>
));
CodeWindowIcon.displayName = "CodeWindowIcon";
