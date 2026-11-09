import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Design. A wide service fanning out to two components. Not Lucide Network (three equal squares).
export const SystemDesignIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="system-design" {...props}>
    <path d="M12 11V12.5Q12 13.5 11 13.5H7.5Q6.5 13.5 6.5 14.5V16M12 12.5Q12 13.5 13 13.5H16.5Q17.5 13.5 17.5 14.5V16" />
    <path className="icon-fill" d="M7 3H17Q21 3 21 7V7Q21 11 17 11H7Q3 11 3 7V7Q3 3 7 3Z" fill="currentColor" stroke="none" />
    <path d="M7 3H17Q21 3 21 7V7Q21 11 17 11H7Q3 11 3 7V7Q3 3 7 3Z" />
    <path className="icon-fill" d="M5.5 16H7.5Q10 16 10 18.5V18.5Q10 21 7.5 21H5.5Q3 21 3 18.5V18.5Q3 16 5.5 16Z" fill="currentColor" stroke="none" />
    <path d="M5.5 16H7.5Q10 16 10 18.5V18.5Q10 21 7.5 21H5.5Q3 21 3 18.5V18.5Q3 16 5.5 16Z" />
    <path className="icon-fill" d="M16.5 16H18.5Q21 16 21 18.5V18.5Q21 21 18.5 21H16.5Q14 21 14 18.5V18.5Q14 16 16.5 16Z" fill="currentColor" stroke="none" />
    <path d="M16.5 16H18.5Q21 16 21 18.5V18.5Q21 21 18.5 21H16.5Q14 21 14 18.5V18.5Q14 16 16.5 16Z" />
  </Icon>
));
SystemDesignIcon.displayName = "SystemDesignIcon";
