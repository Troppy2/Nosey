import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Tests / reading. Open book with bowed pages meeting at a spine.
// Not Lucide BookOpen (flat rectangular pages, straight spine top).
export const BookIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="book" {...props}>
    <Cutout body="M12 7.5Q9 5 4.5 5.5Q3 5.7 3 7.2V16.2Q3 17.6 4.4 17.5Q9 17.3 12 19.5ZM12 7.5Q15 5 19.5 5.5Q21 5.7 21 7.2V16.2Q21 17.6 19.6 17.5Q15 17.3 12 19.5Z" detail="M12 9V18" />
  </Icon>
));
BookIcon.displayName = "BookIcon";
