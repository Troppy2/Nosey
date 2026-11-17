import { forwardRef, useId } from "react";
import { Icon, type IconProps } from "./Icon";

// A video playlist. The centered play symbol stays open when selected.
export const LectureIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const mask = `m${useId().replace(/:/g, "")}`;
  return (
    <Icon ref={ref} name="lecture" {...props}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d="M10.25 11.3Q10.25 10.7 10.85 11.1L14.85 13.5Q15.55 14 14.85 14.5L10.85 16.9Q10.25 17.3 10.25 16.7Z" fill="black" stroke="none" />
      </mask>
      <path d="M7 3H17" />
      <path className="icon-fill" d="M6 7H18Q21 7 21 10V18Q21 21 18 21H6Q3 21 3 18V10Q3 7 6 7Z" mask={`url(#${mask})`} fill="currentColor" stroke="none" />
      <path d="M6 7H18Q21 7 21 10V18Q21 21 18 21H6Q3 21 3 18V10Q3 7 6 7Z" />
      <path className="icon-detail" d="M10.25 11.3Q10.25 10.7 10.85 11.1L14.85 13.5Q15.55 14 14.85 14.5L10.85 16.9Q10.25 17.3 10.25 16.7Z" />
    </Icon>
  );
});
LectureIcon.displayName = "LectureIcon";
