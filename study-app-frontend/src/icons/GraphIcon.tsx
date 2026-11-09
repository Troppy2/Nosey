import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Graph. Three generous nodes in a cycle. Not Lucide Network (square nodes) or Share2 (no cycle).
export const GraphIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="graph" {...props}>
    <path d="M8.5 7.3L15.5 7.8M6.8 9.8L9.7 16.3M16.8 10.5L12.8 16.6" />
    <circle className="icon-fill" cx="5.5" cy="7" r="3" fill="currentColor" stroke="none" />
    <circle cx="5.5" cy="7" r="3" />
    <circle className="icon-fill" cx="18.5" cy="8" r="3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="8" r="3" />
    <circle className="icon-fill" cx="11" cy="19" r="3" fill="currentColor" stroke="none" />
    <circle cx="11" cy="19" r="3" />
  </Icon>
));
GraphIcon.displayName = "GraphIcon";
