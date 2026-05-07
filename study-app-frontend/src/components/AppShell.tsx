import { BookOpen, Brain, ChevronLeft, ChevronRight, Code2, FolderOpen, LayoutDashboard, Menu, MessageCircle, Settings, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

const sidebarStorageKey = "nosey_sidebar_collapsed";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/folders", label: "Folders", icon: FolderOpen },
  { to: "/flashcards", label: "Flashcards", icon: Brain },
  { to: "/leetcode", label: "LeetCode mode", icon: Code2 },
  { to: "/kojo/chat", label: "Chat mode", icon: MessageCircle },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const location = useLocation();
  const [isNavHidden, setIsNavHidden] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(sidebarStorageKey) === "true";
  });
  const lastScrollY = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close drawer on route change
  useEffect(() => {
    setIsDrawerOpen(false);
  }, [location.pathname]);


  useEffect(() => {
    localStorage.setItem(sidebarStorageKey, String(isSidebarCollapsed));
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
      // On desktop the sidebar is a sticky left column — never hide it.
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
      {/* Mobile top bar — shown only on phones (<760px) */}
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

      {/* Backdrop overlay — closes drawer on tap */}
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
        <Outlet />
      </main>
    </div>
  );
}
