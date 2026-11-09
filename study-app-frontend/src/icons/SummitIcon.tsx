import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Advanced. A summit with a flag: the top of the climb. Not Lucide Trophy (cup) or Mountain (sharp peaks).
export const SummitIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="summit" {...props}>
    <path className="icon-fill" d="M2.6 19.4L8 9.6Q9 7.9 10 9.6L12.6 14.2L14.3 11.6Q15.3 10.1 16.3 11.6L21.4 19.4Q21.9 20.5 20.8 20.5H3.2Q2.1 20.5 2.6 19.4Z" fill="currentColor" stroke="none" />
    <path d="M2.6 19.4L8 9.6Q9 7.9 10 9.6L12.6 14.2L14.3 11.6Q15.3 10.1 16.3 11.6L21.4 19.4Q21.9 20.5 20.8 20.5H3.2Q2.1 20.5 2.6 19.4Z" />
    <path d="M9 8.6V3" />
    <path className="icon-fill" d="M9 3H12.6Q13.6 3 13.1 3.9L12.6 4.6L13.1 5.3Q13.6 6.2 12.6 6.2H9Z" fill="currentColor" stroke="none" />
    <path d="M9 3H12.6Q13.6 3 13.1 3.9L12.6 4.6L13.1 5.3Q13.6 6.2 12.6 6.2H9Z" />
  </Icon>
));
SummitIcon.displayName = "SummitIcon";
