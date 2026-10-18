import { forwardRef, useId } from "react";
import { Icon, type IconProps } from "./Icon";

// Folder (replaces Folder and FolderOpen). Squat back with a soft tab, plus a
// separate front panel. Hover (nav and dock only): the paths morph to an open
// folder (front panel slants forward, back sides re-meet it), via CSS `d` in
// icons.css. Browsers without CSS `d` support simply keep the closed folder.
// Not Lucide Folder (thin tab with a hard step, rx 2 body, one piece).
// Every path keeps the same command sequence as its open twin in icons.css.
export const FOLDER_BACK = "M3 16L3 8.5Q3 5 6.5 5H9.3Q10.3 5 11 5.8L12 7H17.5Q21 7 21 10.5L21 16";
const BACK_FILL = "M3 16L3 8.5Q3 5 6.5 5H9.3Q10.3 5 11 5.8L12 7H17.5Q21 7 21 10.5L21 16Q21 19.5 17.5 19.5H6.5Q3 19.5 3 16Z";
export const FOLDER_FRONT = "M3.6 10.5H20.4Q21 10.5 21 11.1L21 16Q21 19.5 17.5 19.5H6.5Q3 19.5 3 16L3 11.1Q3 10.5 3.6 10.5Z";

export const FolderIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const mask = `m${useId().replace(/:/g, "")}`;
  return (
    <Icon ref={ref} name="folder" {...props}>
      {/* Filled: the back is masked by a wide stroke of the front panel, so a gap
          always separates them, open or closed. */}
      <mask id={mask} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
        <rect x="-2" y="-2" width="28" height="28" fill="white" stroke="none" />
        <path className="folder-front" d={FOLDER_FRONT} fill="black" stroke="black" strokeWidth="6" />
      </mask>
      <g className="icon-fill" mask={`url(#${mask})`} fill="currentColor" stroke="none">
        <path d={BACK_FILL} />
      </g>
      <path className="folder-back" d={FOLDER_BACK} />
      <g className="icon-fill" fill="currentColor" stroke="none">
        <path className="folder-front" d={FOLDER_FRONT} />
      </g>
      <path className="folder-front" d={FOLDER_FRONT} />
    </Icon>
  );
});
FolderIcon.displayName = "FolderIcon";
