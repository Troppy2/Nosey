import { useEffect, useState } from "react";

// The mobile shell (top bar + bottom dock) is chosen by the same query the CSS
// uses, so markup and styling can never disagree.
//
// Width alone is not enough. Android page-zoom widens the layout viewport in
// CSS pixels, so a zoomed-out phone reports well over 760px and used to fall
// into the tablet layout: a wrapped horizontal sidebar and 2-up card grids that
// were never meant for a phone. Touch devices therefore keep the mobile shell
// at any zoom level, up to the desktop breakpoint.
//
// 2026-11-15: touch is judged by the SCREEN, not the window. Touchscreen
// laptops report hover: none / pointer: coarse with no fine pointer, exactly
// like a tablet, so "touch and window <= 1100px" put a narrow laptop window in
// the phone layout. max-device-width is the screen width in CSS pixels: phones
// and tablets are at most ~1100 (and page zoom does not change it, which keeps
// the zoomed-out phone fix above), touch laptops are 1280+.
export const MOBILE_SHELL_QUERY =
  "(max-width: 760px), (hover: none) and (pointer: coarse) and (max-device-width: 1100px)";

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
