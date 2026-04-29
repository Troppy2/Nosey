import { BookOpen, Brain, FolderOpen, LayoutDashboard, Plus, Settings } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "./Button";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/folders", label: "Folders", icon: FolderOpen },
  { to: "/flashcards", label: "Flashcards", icon: Brain },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary navigation">
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

        <div className="sidebar-actions">
          <Button icon={<Plus size={18} />} fullWidth onClick={() => navigate("/create-test")}>
            New Test
          </Button>
        </div>
      </aside>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
