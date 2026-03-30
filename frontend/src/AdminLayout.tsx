import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChartBarIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  HomeIcon,
  ShieldCheckIcon,
  AdjustmentsHorizontalIcon,
  ClockIcon,
  UserPlusIcon,
  CpuChipIcon,
  SwatchIcon,
  Bars3Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "./contexts/AuthContext";
import { t } from "./i18n";

const adminNav = [
  { to: "/admin", end: true, label: t("admin.nav.dashboard"), icon: ChartBarIcon },
  { to: "/admin/users", end: false, label: t("admin.nav.users"), icon: UserGroupIcon },
  { to: "/admin/activity", end: false, label: t("admin.nav.activity"), icon: ClockIcon },
  { to: "/admin/usage", end: false, label: t("admin.nav.usage"), icon: CpuChipIcon },
  { to: "/admin/referrals", end: false, label: t("admin.nav.referrals"), icon: UserPlusIcon },
  { to: "/admin/config", end: false, label: t("admin.nav.config"), icon: AdjustmentsHorizontalIcon },
  { to: "/admin/app", end: false, label: t("admin.nav.app"), icon: Cog6ToothIcon },
  { to: "/admin/visual", end: false, label: t("admin.nav.visual"), icon: SwatchIcon },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const sidebarContent = (
    <>
      <div className="flex items-center gap-2 mb-8 px-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15" aria-hidden>
          <ShieldCheckIcon className="w-5 h-5" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <img src="/logo-white.svg" alt="" className="w-6 h-6 object-contain shrink-0" />
            <div className="font-bold text-lg tracking-tight drop-shadow-sm">PitchCV</div>
          </div>
          <div className="text-[11px] font-medium text-white/70 uppercase tracking-wider">{t("admin.badge")}</div>
        </div>
      </div>

      <nav className="space-y-1">
        {adminNav.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={closeMobileMenu}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive ? "bg-white/20 text-white shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white"
              }`
            }
            aria-current="page"
          >
            <Icon className="w-5 h-5 shrink-0 opacity-100" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto pt-4 border-t border-white/15">
        <button
          type="button"
          onClick={() => {
            closeMobileMenu();
            navigate("/");
          }}
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
    </>
  );

  return (
    <div className="h-screen bg-[var(--bg-page)] flex overflow-hidden" role="application" aria-label={t("admin.panelLabel")}>
      <aside
        className="hidden md:flex w-64 shrink-0 flex-col py-6 px-4 min-h-0 overflow-y-auto text-white shadow-xl z-20"
        style={{ background: "linear-gradient(160deg, #2f40df 0%, #1a28a8 100%)" }}
        role="navigation"
        aria-label={t("admin.navLabel")}
      >
        {sidebarContent}
      </aside>

      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label={t("admin.navLabel")}>
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            onClick={closeMobileMenu}
            aria-label="Close admin mobile menu overlay"
          />
          <aside
            className="relative ml-0 h-full w-[86vw] max-w-[320px] flex flex-col py-5 px-4 overflow-auto text-white shadow-2xl z-10"
            style={{ background: "linear-gradient(160deg, #2f40df 0%, #1a28a8 100%)" }}
            role="navigation"
            aria-label={t("admin.navLabel")}
          >
            <button
              type="button"
              onClick={closeMobileMenu}
              className="absolute right-3 top-3 inline-flex items-center justify-center rounded-lg p-1.5 text-white/90 hover:bg-white/15 hover:text-white"
              aria-label="Close admin mobile menu"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-[var(--bg-page)]">
        <header className="shrink-0 bg-[var(--card)] border-b border-[#EBEDF5] flex items-center justify-between px-4 md:px-6 h-14 z-10 gap-3">
          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[#F5F6FA] hover:text-[#181819] shrink-0"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open admin mobile menu"
          >
            <Bars3Icon className="w-6 h-6" />
          </button>

          {location.pathname.includes("/admin/visual") ? (
            <div id="admin-header-portal" className="flex-1 flex items-center min-w-0" />
          ) : (
            <>
              <h1 className="text-base font-semibold text-[var(--text)]">{t("admin.title")}</h1>
              <div className="md:hidden w-6 shrink-0" aria-hidden />
            </>
          )}
        </header>

        <main className="flex-1 min-h-0 flex flex-col overflow-hidden pt-3 md:pt-4 pb-6 md:pb-8 px-3 md:px-6" role="main">
          <div className="flex-1 min-h-0 flex flex-col min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
