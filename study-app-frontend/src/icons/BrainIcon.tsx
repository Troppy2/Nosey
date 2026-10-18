import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Memory / flashcard weak spots. Four plump lobes with a middle seam and two folds.
// Not Lucide Brain (asymmetric outlined lobes with many inner curls).
export const BrainIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="brain" {...props}>
    <Cutout body="M12 5.5Q10 3.6 7.5 4.6Q4.6 5.6 4.7 8.6Q2.9 10.5 3.7 13.1Q3.5 16.9 7.1 17.9Q9.5 20.4 12 18.4Q14.5 20.4 16.9 17.9Q20.5 16.9 20.3 13.1Q21.1 10.5 19.3 8.6Q19.4 5.6 16.5 4.6Q14 3.6 12 5.5Z" detail="M12 8V16M7.8 10.2Q9.3 10.7 9.3 12.7M16.2 10.2Q14.7 10.7 14.7 12.7" />
  </Icon>
));
BrainIcon.displayName = "BrainIcon";
