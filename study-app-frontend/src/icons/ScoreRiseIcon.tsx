import { forwardRef, useId } from "react";
import { Icon, type IconProps } from "./Icon";

// Scores going up: three pill bars climbing inside a soft card.
// Not Lucide's ChartColumn / TrendingUp (open axes or a zigzag arrow).
const CARD = "M7 5H17A4 4 0 0 1 21 9V15A4 4 0 0 1 17 19H7A4 4 0 0 1 3 15V9A4 4 0 0 1 7 5Z";
const BARS = "M8 15V13M12 15V11M16 15V9";

export const ScoreRiseIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const mask = `m${useId().replace(/:/g, "")}`;
  return (
    <Icon ref={ref} name="score-rise" {...props}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d={BARS} stroke="black" />
      </mask>
      <g className="icon-fill" mask={`url(#${mask})`} fill="currentColor" stroke="none">
        <path d={CARD} />
      </g>
      <path d={CARD} />
      <g className="icon-detail">
        <path d="M8 15V13M12 15V11" />
        <path className="icon-part-top" d="M16 15V9" />
      </g>
    </Icon>
  );
});
ScoreRiseIcon.displayName = "ScoreRiseIcon";
