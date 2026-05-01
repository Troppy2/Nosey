import { BookOpen, Brain, FolderOpen, LayoutDashboard, Settings } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/folders", label: "Folders", icon: FolderOpen },
  { to: "/flashcards", label: "Flashcards", icon: Brain },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const navigate = useNavigate();
  const [isNavHidden, setIsNavHidden] = useState(false);
  const lastScrollY = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isScrolling = false;

    const handleScroll = () => {
      // On desktop the sidebar is a sticky left column — never hide it
      if (window.innerWidth > 1100) {
        setIsNavHidden(false);
        return;
      }

      const currentScrollY = window.scrollY;
      const isScrollingDown = currentScrollY > lastScrollY.current;

      setIsNavHidden(isScrollingDown && currentScrollY > 100);
      lastScrollY.current = currentScrollY;

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        setIsNavHidden(false);
      }, 1500);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary navigation" data-hidden={isNavHidden}>
        <Link className="brand-lockup brand-link" to="/dashboard" aria-label="Go to dashboard">
          <div className="brand-mark">
            <BookOpen size={22} />
          </div>
          <div>
            <strong>Nosey</strong>
            <span>Study workspace</span>
          </div>
        </Link>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} className="nav-link" to={item.to}>
                <Icon size={19} />
                <span>{item.label}</span>
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
