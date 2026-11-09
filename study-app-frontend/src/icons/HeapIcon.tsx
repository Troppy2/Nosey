import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Heap / Priority Queue. A larger root above two children: highest priority on top. Not Lucide Share2 (equal nodes, sideways).
export const HeapIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="heap" {...props}>
    <path d="M9.8 8.4L7 14.6M14.2 8.4L17 14.6" />
    <circle className="icon-fill" cx="12" cy="5.5" r="3.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="5.5" r="3.5" />
    <circle className="icon-fill" cx="5.5" cy="17.5" r="3" fill="currentColor" stroke="none" />
    <circle cx="5.5" cy="17.5" r="3" />
    <circle className="icon-fill" cx="18.5" cy="17.5" r="3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="17.5" r="3" />
  </Icon>
));
HeapIcon.displayName = "HeapIcon";
