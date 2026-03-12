import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChartBarIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  HomeIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "./contexts/AuthContext";
import { t } from "./i18n";

const adminNav = [
  { to: "/admin", end: true, label: t("admin.nav.dashboard"), icon: ChartBarIcon },
  { to: "/admin/users", end: false, label: t("admin.nav.users"), icon: UserGroupIcon },
  { to: "/admin/app", end: false, label: t("admin.nav.app"), icon: Cog6ToothIcon },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="h-screen bg-[var(--bg-page)] flex overflow-hidden" role="application" aria-label={t("admin.panelLabel")}>
      {/* Admin sidebar: darker accent to distinguish from main app */}
      <aside
        className="w-64 shrink-0 flex flex-col py-6 px-4 overflow-hidden text-white shadow-xl z-20"
        style={{ background: "linear-gradient(160deg, #2f40df 0%, #1a28a8 100%)" }}
        role="navigation"
        aria-label={t("admin.navLabel")}
      >
        <div className="flex items-center gap-2 mb-8 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15" aria-hidden>
            <ShieldCheckIcon className="w-5 h-5" />
          </span>
          <div>
            <div className="font-bold text-lg tracking-tight drop-shadow-sm">HR-Breaker</div>
            <div className="text-[11px] font-medium text-white/70 uppercase tracking-wider">{t("admin.badge")}</div>
          </div>
        </div>

        <nav className="space-y-1">
          {adminNav.map(({ to, end, label, icon: Icon }) => {
            const active = end ? location.pathname === to : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                end={end}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/20 text-white shadow-sm"
                    : "text-white/85 hover:bg-white/10 hover:text-white"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="w-5 h-5 shrink-0 opacity-100" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-4 border-t border-white/15">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            <HomeIcon className="w-4 h-4 shrink-0" aria-hidden />
            {t("admin.backToApp")}
          </button>
        </div>

        {user && (
          <div className="pt-4 mt-4 border-t border-white/15">
            <p className="text-[11px] font-semibold text-white/70 uppercase tracking-wider px-1">{t("admin.signedInAs")}</p>
            <p className="text-sm font-medium text-white truncate mt-1 px-1" title={user.email}>
              {user.email}
            </p>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-[var(--bg-page)]">
        <header className="shrink-0 bg-[var(--card)] border-b border-[#EBEDF5] flex items-center justify-between px-6 h-14 z-10">
          <h1 className="text-base font-semibold text-[var(--text)]">{t("admin.title")}</h1>
        </header>

        <main className="flex-1 min-h-0 overflow-auto pt-4 pb-8 px-6" role="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
