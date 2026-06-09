import { BookOpen, Brain, ChevronLeft, ChevronRight, Code2, FolderOpen, LayoutDashboard, Menu, MessageCircle, Settings, ShieldCheck, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../lib/useSettings";
import { getStoredUser, isGuestSession, scopeKey } from "../lib/api";
import { OnboardingTour } from "./OnboardingTour";

const ADMIN_EMAIL = "jamesinah34@gmail.com";

const sidebarStorageKey = "nosey_sidebar_collapsed";

const BASE_NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, beta: false, guestHidden: false, tourId: undefined },
  { to: "/folders", label: "Folders", icon: FolderOpen, beta: false, guestHidden: false, tourId: "tour-nav-folders" },
  { to: "/flashcards", label: "Flashcards", icon: Brain, beta: false, guestHidden: false, tourId: undefined },
  { to: "/leetcode", label: "LeetCode mode", icon: Code2, beta: true, guestHidden: true, tourId: undefined },
  { to: "/kojo/chat", label: "Chat", icon: MessageCircle, beta: false, guestHidden: true, tourId: "tour-nav-kojo" },
  { to: "/settings", label: "Settings", icon: Settings, beta: false, guestHidden: false, tourId: undefined },
];

export function Sidebar() {
  const location = useLocation();
  const { betaMode } = useSettings();
  const guest = isGuestSession();
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const adminItem = { to: "/admin", label: "Admin", icon: ShieldCheck, beta: false, guestHidden: true, tourId: undefined };
  const kojoEnabled = currentUser?.kojo_enabled !== false;
  const navItems = [
    ...BASE_NAV_ITEMS.filter((item) =>
      (!item.beta || betaMode) &&
      (!item.guestHidden || !guest) &&
      (item.to !== "/kojo/chat" || kojoEnabled)
    ),
    ...(isAdmin && !guest ? [adminItem] : []),
  ];
  const [isNavHidden, setIsNavHidden] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(scopeKey(sidebarStorageKey)) === "true";
  });
  const lastScrollY = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close drawer on route change
  useEffect(() => {
    setIsDrawerOpen(false);
  }, [location.pathname]);


  useEffect(() => {
    localStorage.setItem(scopeKey(sidebarStorageKey), String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  // Close drawer on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsDrawerOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // Lock body scroll while mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = isDrawerOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isDrawerOpen]);

  useEffect(() => {
    const handleScroll = () => {
      // On desktop the sidebar is a sticky left column , never hide it.
      // On mobile (<760px) the drawer handles visibility; skip scroll-hide there too.
      if (window.innerWidth > 1100 || window.innerWidth <= 760) {
        setIsNavHidden(false);
        return;
      }

      const currentScrollY = window.scrollY;
      const isScrollingDown = currentScrollY > lastScrollY.current;

      setIsNavHidden(isScrollingDown && currentScrollY > 100);
      lastScrollY.current = currentScrollY;

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

      scrollTimeoutRef.current = setTimeout(() => {
        setIsNavHidden(false);
      }, 1500);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  return (
    <div className="shell" data-sidebar-collapsed={isSidebarCollapsed}>
      {/* Mobile top bar , shown only on phones (<760px) */}
      <div className="mobile-topbar">
        <Link className="brand-lockup brand-link" to="/dashboard" aria-label="Go to dashboard">
          <div className="brand-mark">
            <BookOpen size={20} />
          </div>
          <strong>Nosey</strong>
        </Link>
        <button
          className="hamburger-btn"
          onClick={() => setIsDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={isDrawerOpen}
        >
          <Menu size={22} />
        </button>
      </div>

      {/* Backdrop overlay , closes drawer on tap */}
      <div
        className="sidebar-backdrop"
        data-visible={isDrawerOpen}
        onClick={() => setIsDrawerOpen(false)}
        aria-hidden="true"
      />

      <aside
        className="sidebar"
        aria-label="Primary navigation"
        data-hidden={isNavHidden}
        data-open={isDrawerOpen}
        data-collapsed={isSidebarCollapsed}
      >
        {/* sidebar-header wraps brand controls; close is hidden on desktop */}
        <div className="sidebar-header">
          <Link className="brand-lockup brand-link" to="/dashboard" aria-label="Go to dashboard" title="Go to dashboard">
            <div className="brand-mark">
              <BookOpen size={22} />
            </div>
            <div className="brand-copy">
              <strong>Nosey</strong>
              <span>Study workspace</span>
            </div>
          </Link>
          <button
            className="sidebar-collapse-btn"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={isSidebarCollapsed}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <button
            className="drawer-close-btn"
            onClick={() => setIsDrawerOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                id={item.tourId}
                className="nav-link"
                to={item.to}
                aria-label={item.label}
                title={isSidebarCollapsed ? item.label : undefined}
              >
                <Icon size={19} />
                <span className="nav-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <main className="shell-main">
        <OnboardingTour />
        <Outlet />
      </main>
    </div>
  );
}
