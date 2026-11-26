import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";
import { Cutout } from "./Cutout";

// Testcase tab. A soft card with a small tick next to one line and a full line below.
// Not Lucide ListChecks (no frame, sharp ticks).
export const TestcaseIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="testcase" {...props}>
    <Cutout
      body="M7 4H17Q20 4 20 7V17Q20 20 17 20H7Q4 20 4 17V7Q4 4 7 4Z"
      detail="M7.6 10L9.2 11.5L11.6 8.8M13.8 10.2H16.4M7.8 15H16.2"
    />
  </Icon>
));
TestcaseIcon.displayName = "TestcaseIcon";
