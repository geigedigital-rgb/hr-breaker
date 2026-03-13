import { Link, Outlet, useLocation } from "react-router-dom";
import {
  DocumentTextIcon,
  Cog6ToothIcon,
  HomeIcon,
  ArrowRightOnRectangleIcon,
  UserPlusIcon,
  FireIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "./contexts/AuthContext";
import { isAdminUser } from "./api";
import { Tooltip } from "./components/Tooltip";
import {
  READINESS_STAGE_LABEL,
  READINESS_STAGE_ICON_STYLE,
  READINESS_STAGE_ICON_IMAGE,
} from "./readiness";
import { t } from "./i18n";
import { NotificationMenu } from "./components/NotificationMenu";

const nav = [
  { to: "/", label: t("nav.home"), icon: HomeIcon },
  { to: "/history", label: t("nav.history"), icon: DocumentTextIcon },
];

export default function Layout() {
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="h-screen bg-[#F2F3F9] flex overflow-hidden">
      {/* Sidebar spanning full height */}
      <aside 
        className="w-64 shrink-0 flex flex-col py-6 px-4 overflow-hidden text-white shadow-xl z-20"
        style={{ background: "linear-gradient(160deg, #4558ff 0%, #2f40df 100%)" }}
      >
        <div className="flex items-center gap-2.5 mb-8 px-2">
          <img src="/logo-white.svg" alt="" className="w-8 h-8 object-contain shrink-0" />
          <div className="font-bold text-2xl tracking-tight drop-shadow-sm">PitchCV</div>
        </div>
        
        <nav className="space-y-1">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="w-5 h-5 shrink-0 opacity-100" />
                {label}
              </Link>
            );
          })}
          {user && isAdminUser(user) && (
            <Link
              to="/admin"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                location.pathname.startsWith("/admin")
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              }`}
              title={t("admin.nav.dashboard")}
            >
              <ShieldCheckIcon className="w-5 h-5 shrink-0 opacity-100" />
              Admin
            </Link>
          )}
        </nav>

        <div className="mt-auto pt-4 border-t border-white/15 space-y-1">
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            title={t("nav.inviteSoon")}
          >
            <UserPlusIcon className="w-4 h-4 shrink-0 opacity-90" />
            <span className="truncate">{t("nav.inviteFriends")}</span>
          </button>
          <Link
            to="/settings"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              location.pathname === "/settings"
                ? "bg-white/15 text-white"
                : "text-white/80 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Cog6ToothIcon className="w-4 h-4 shrink-0 opacity-90" />
            {t("nav.settings")}
          </Link>
        </div>

        <div className="pt-4 mt-4 border-t border-white/15">
          {user && user.id !== "local" ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-medium shrink-0">
                {user.name ? user.name.slice(0, 2).toUpperCase() : user.email.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">
                  {user.name || user.email.split("@")[0]}
                </p>
                <p className="text-xs text-white/80 truncate">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="shrink-0 p-1.5 rounded-lg text-white/80 hover:bg-white/15 hover:text-white transition-colors"
                title={t("nav.logout")}
                aria-label={t("nav.logout")}
              >
                <ArrowRightOnRectangleIcon className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white/90 text-sm shrink-0">
                👤
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{t("nav.localMode")}</p>
                <p className="text-xs text-white/80">{t("nav.noAccount")}</p>
              </div>
            </div>
          )}
        </div>

        {user && user.id !== "local" && user.readiness && (
          <div className="mt-5 space-y-2">
            <h3 className="text-[11px] font-semibold text-white/90 uppercase tracking-wider px-1">{t("nav.yourProgress")}</h3>
            <Link
              to="/progress"
              className="block rounded-xl p-3.5 bg-white/85 border border-white/20 transition-all hover:opacity-95 focus:opacity-95 outline-none shadow-md group"
              aria-label={t("nav.goToProgress")}
            >
              <div className="flex items-center gap-3 mb-2.5">
                {READINESS_STAGE_ICON_IMAGE[user.readiness.stage] ? (
                  <img
                    src={READINESS_STAGE_ICON_IMAGE[user.readiness.stage]}
                    alt=""
                    className="block w-6 h-6 object-contain shrink-0 drop-shadow-[0_2px_8px_rgba(168,85,247,0.4)]"
                  />
                ) : (
                  <span
                    className="block w-6 h-6 shrink-0 drop-shadow-[0_2px_8px_rgba(168,85,247,0.4)]"
                    style={READINESS_STAGE_ICON_STYLE[user.readiness.stage] ?? READINESS_STAGE_ICON_STYLE.Emerging}
                  />
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-[13px] font-bold text-[#0f172a] leading-tight truncate group-hover:text-[#7c3aed] transition-colors">{READINESS_STAGE_LABEL[user.readiness.stage] ?? user.readiness.stage}</span>
                  <span className="text-[11px] font-semibold text-[#334155] mt-0.5">{t("nav.toNextLevel")} {Math.round(user.readiness.progress_to_next * 100)}%</span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-[#EBEDF5] overflow-hidden" role="progressbar" aria-valuenow={Math.round(user.readiness.progress_to_next * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className="h-full rounded-full transition-[width] duration-300 ease-out relative overflow-hidden"
                  style={{
                    width: `${Math.round(user.readiness.progress_to_next * 100)}%`,
                    background: "linear-gradient(90deg, #a855f7 0%, #c084fc 35%, #ec4899 100%)",
                  }}
                >
                  <div className="absolute inset-0 w-full h-full" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)", animation: "shimmer 2s infinite" }} />
                </div>
              </div>
            </Link>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-[#F2F3F9]">
        <header className="shrink-0 bg-white border-b border-[#EBEDF5] flex items-center justify-between px-6 h-16 z-10 relative">
          {/* Left space for future breadcrumbs/title if needed */}
          <div className="flex-1" />
          
          <div className="flex items-center gap-4">
            <Link
              to="/upgrade"
              className="inline-flex items-center gap-2 h-[34px] px-4 rounded-full text-white text-[13px] font-bold transition-all shadow-sm hover:shadow-md hover:opacity-95 active:scale-[0.98] tracking-tight"
              style={{ background: "linear-gradient(160deg, #4558ff 0%, #2f40df 100%)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M2.5 17L4.5 7L9.5 11.5L12 4.5L14.5 11.5L19.5 7L21.5 17H2.5Z" />
                <path d="M2.5 19H21.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
              </svg>
              Upgrade Now
            </Link>
            {user && user.id !== "local" && user.readiness && (
              <div className="flex items-center gap-2">
                <Tooltip
                  title={READINESS_STAGE_LABEL[user.readiness.stage] ?? user.readiness.stage}
                  description={t("nav.readinessTooltip")}
                  side="bottom"
                >
                  <div className="flex items-center gap-2 rounded-full bg-[#F5F6FA] border border-[#EBEDF5] px-3 py-1.5 cursor-default hover:bg-[#EBEDF5] transition-colors">
                    {READINESS_STAGE_ICON_IMAGE[user.readiness.stage] ? (
                      <img
                        src={READINESS_STAGE_ICON_IMAGE[user.readiness.stage]}
                        alt=""
                        className="block w-4 h-4 shrink-0 object-contain"
                      />
                    ) : (
                      <span
                        className="block w-4 h-4 shrink-0"
                        style={READINESS_STAGE_ICON_STYLE[user.readiness.stage] ?? READINESS_STAGE_ICON_STYLE.Emerging}
                      />
                    )}
                    <span className="text-sm font-medium tabular-nums text-[#181819]">{user.readiness.score}</span>
                  </div>
                </Tooltip>
                {user.readiness.streak_days > 0 && (
                  <Tooltip
                  title={t("nav.streakDays")}
                  description={t("nav.streakTooltip")}
                    side="bottom"
                  >
                    <div className="flex items-center gap-2 rounded-full bg-[#F5F6FA] border border-[#EBEDF5] px-3 py-1.5 cursor-default hover:bg-[#EBEDF5] transition-colors">
                      <FireIcon className="w-4 h-4 shrink-0 text-[#4578FC]" />
                      <span className="text-sm font-medium tabular-nums text-[#181819]">{user.readiness.streak_days}</span>
                    </div>
                  </Tooltip>
                )}
                <NotificationMenu />
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-auto pt-2 pb-6 px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
