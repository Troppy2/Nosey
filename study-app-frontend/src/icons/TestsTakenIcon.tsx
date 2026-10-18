import { forwardRef, useId } from "react";
import { Icon, type IconProps } from "./Icon";

// Finished tests: a squat sheet with a check, the edge of the stack peeking above.
// Not Lucide's ClipboardList (tall clipboard, clip, list lines) or Copy (two offset squares).
const FRONT = "M7 9H17A4 4 0 0 1 21 13V17A4 4 0 0 1 17 21H7A4 4 0 0 1 3 17V13A4 4 0 0 1 7 9Z";
const STACK = "M9.5 2.5H14.5M6.5 5.75H17.5";
const CHECK = "M8.8 15L10.8 17Q11.3 17.5 11.8 17L15.2 13.6";

export const TestsTakenIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const mask = `m${useId().replace(/:/g, "")}`;
  return (
    <Icon ref={ref} name="tests-taken" {...props}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d={CHECK} stroke="black" />
      </mask>
      <path className="icon-part-back" d={STACK} />
      <g className="icon-fill" mask={`url(#${mask})`} fill="currentColor" stroke="none">
        <path d={FRONT} />
      </g>
      <path d={FRONT} />
      <path className="icon-detail" d={CHECK} />
    </Icon>
  );
});
TestsTakenIcon.displayName = "TestsTakenIcon";
