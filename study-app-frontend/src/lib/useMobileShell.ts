import { useEffect, useState } from "react";

// The mobile shell (top bar + bottom dock) is chosen by the same query the CSS
// uses, so markup and styling can never disagree.
//
// Width alone is not enough. Android page-zoom widens the layout viewport in
// CSS pixels, so a zoomed-out phone reports well over 760px and used to fall
// into the tablet layout: a wrapped horizontal sidebar and 2-up card grids that
// were never meant for a phone. Touch devices therefore keep the mobile shell
// at any zoom level, up to the desktop breakpoint.
export const MOBILE_SHELL_QUERY =
  "(max-width: 760px), (hover: none) and (pointer: coarse) and (max-width: 1100px)";

export function useMobileShell() {
  const [isMobileShell, setIsMobileShell] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_SHELL_QUERY).matches;
  });

  useEffect(() => {
    const query = window.matchMedia(MOBILE_SHELL_QUERY);
    const update = () => setIsMobileShell(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isMobileShell;
}
