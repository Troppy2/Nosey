import { forwardRef, useId } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode rail: Lectures. A lesson screen with a play cutout on a stand. Not Lucide MonitorPlay (rx2, thin play).
export const LectureIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const mask = `m${useId().replace(/:/g, "")}`;
  return (
    <Icon ref={ref} name="lecture" {...props}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d="M9.8 7.7Q9.8 6.4 11 7L15.3 9.3Q16.5 10 15.3 10.7L11 13Q9.8 13.6 9.8 12.3Z" fill="black" stroke="black" />
      </mask>
      <path className="icon-fill" d="M6.5 3H17.5Q21.5 3 21.5 7V13Q21.5 17 17.5 17H6.5Q2.5 17 2.5 13V7Q2.5 3 6.5 3Z" mask={`url(#${mask})`} fill="currentColor" stroke="none" />
      <path d="M6.5 3H17.5Q21.5 3 21.5 7V13Q21.5 17 17.5 17H6.5Q2.5 17 2.5 13V7Q2.5 3 6.5 3Z" />
      <path d="M9.8 7.7Q9.8 6.4 11 7L15.3 9.3Q16.5 10 15.3 10.7L11 13Q9.8 13.6 9.8 12.3Z" />
      <path d="M8.5 21H15.5M12 17V21" />
    </Icon>
  );
});
LectureIcon.displayName = "LectureIcon";
