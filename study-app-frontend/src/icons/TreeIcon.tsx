import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Tree. A rooted tree with one deeper child, so it never reads as the heap. Not Lucide GitBranch / Network.
export const TreeIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="tree" {...props}>
    <path d="M10.4 6.6L7.3 10.4M13.6 6.6L16.7 10.4M18.5 15V17.5" />
    <circle className="icon-fill" cx="12" cy="4.5" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="4.5" r="2.5" />
    <circle className="icon-fill" cx="5.5" cy="12.5" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="5.5" cy="12.5" r="2.5" />
    <circle className="icon-fill" cx="18.5" cy="12.5" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12.5" r="2.5" />
    <circle className="icon-fill" cx="18.5" cy="19.5" r="2" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="19.5" r="2" />
  </Icon>
));
TreeIcon.displayName = "TreeIcon";
