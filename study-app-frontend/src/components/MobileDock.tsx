import type { LucideIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "../styles/components/mobile-dock.css";

export type DockItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  tourId?: string;
};

// Screens with a fixed composer or answer box, where a floating dock would sit
// on top of the input. These render no dock; each already owns its own header
// with a back control, so the shell adds nothing on top of them (an overlay
// button here landed on Kojo chat's "Open chats and folders" menu button and
// bounced people out of the chat).
const IMMERSIVE_PATTERNS = [
  /^\/test\/[^/]+$/,
  /^\/flashcards\/[^/]+\/review$/,
  /^\/flashcards\/[^/]+\/matching$/,
  /^\/flashcards\/[^/]+\/episode\/[^/]+$/,
  /^\/kojo\/chat$/,
  /^\/leetcode$/,
  /^\/mock-interview\/[^/]+\/stage\d$/,
];

export function isImmersiveRoute(pathname: string) {
  return IMMERSIVE_PATTERNS.some((pattern) => pattern.test(pathname));
}

const HIDE_AFTER_PX = 100;

/**
 * Bottom navigation for the mobile shell: a floating pill of icon-only links
 * that share the rail evenly, so every destination is visible at once on any
 * phone width. The current route is marked with a filled circle. Item names
 * live in the tooltip and the accessibility tree rather than on screen: a
 * labelled active item cannot fit alongside six or seven others at 375px, and
 * a nav bar with items cut off the edge reads as broken rather than scrollable.
 */
export function MobileDock({ items }: { items: DockItem[] }) {
  const location = useLocation();
  const [isHidden, setIsHidden] = useState(false);
  const lastScrollY = useRef(0);

  // Same idiom as the desktop sidebar's scroll-hide: passive listener, last
  // position in a ref. Scrolling up by any amount brings the dock straight back.
  useEffect(() => {
    const handleScroll = () => {
      const current = window.scrollY;
      setIsHidden(current > lastScrollY.current && current > HIDE_AFTER_PX);
      lastScrollY.current = current;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // A route change resets the page to the top, so the dock should come back.
  useEffect(() => {
    setIsHidden(false);
    lastScrollY.current = window.scrollY;
  }, [location.pathname]);

  return (
    <div className="mobile-dock" data-hidden={isHidden}>
      <nav className="dock-rail" aria-label="Primary navigation">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} id={item.tourId} className="dock-link" to={item.to} title={item.label}>
              <Icon className="dock-icon" size={21} aria-hidden="true" />
              <span className="dock-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

export default MobileDock;
