import { Link, Outlet, useLocation } from "react-router-dom";
import {
  DocumentTextIcon,
  Cog6ToothIcon,
  HomeIcon,
  ArrowRightOnRectangleIcon,
  UserPlusIcon,
  FireIcon,
  BellIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "./contexts/AuthContext";
import { Tooltip } from "./components/Tooltip";
import {
  READINESS_STAGE_LABEL,
  READINESS_STAGE_ICON_STYLE,
  READINESS_STAGE_ICON_IMAGE,
  READINESS_HERO_GRADIENT,
} from "./readiness";

const nav = [
  { to: "/", label: "Главная", icon: HomeIcon },
  { to: "/history", label: "История", icon: DocumentTextIcon },
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
        <div className="font-bold text-2xl tracking-tight mb-8 px-2 drop-shadow-sm">HR-Breaker</div>
        
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
        </nav>

        <div className="mt-auto pt-4 border-t border-white/15 space-y-1">
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            title="Скоро"
          >
            <UserPlusIcon className="w-4 h-4 shrink-0 opacity-90" />
            <span className="truncate">Пригласить друзей</span>
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
            Настройки
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
                title="Выйти"
                aria-label="Выйти"
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
                <p className="text-sm font-semibold text-white">Локальный режим</p>
                <p className="text-xs text-white/80">Без аккаунта</p>
              </div>
            </div>
          )}
        </div>

        {user && user.id !== "local" && user.readiness && (
          <div className="mt-5 space-y-2">
            <h3 className="text-[11px] font-semibold text-white/90 uppercase tracking-wider px-1">Ваш прогресс</h3>
            <Link
              to="/progress"
              className="block rounded-xl p-3.5 bg-white border border-transparent transition-all hover:opacity-95 focus:opacity-95 outline-none shadow-md group"
              aria-label="Перейти на страницу Прогресс"
            >
              <div className="flex items-center gap-3 mb-2.5">
                <div className="w-8 h-8 rounded-full bg-[#F5F6FA] flex items-center justify-center shrink-0">
                  {READINESS_STAGE_ICON_IMAGE[user.readiness.stage] ? (
                    <img
                      src={READINESS_STAGE_ICON_IMAGE[user.readiness.stage]}
                      alt=""
                      className="block w-5 h-5 object-contain"
                    />
                  ) : (
                    <span
                      className="block w-5 h-5"
                      style={READINESS_STAGE_ICON_STYLE[user.readiness.stage] ?? READINESS_STAGE_ICON_STYLE.Emerging}
                    />
                  )}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[13px] font-bold text-[#181819] leading-tight truncate group-hover:text-[#4558ff] transition-colors">{READINESS_STAGE_LABEL[user.readiness.stage] ?? user.readiness.stage}</span>
                  <span className="text-[11px] text-[var(--text-tertiary)] font-medium mt-0.5">До след. уровня: {Math.round(user.readiness.progress_to_next * 100)}%</span>
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
              className="inline-flex items-center justify-center h-9 px-4 rounded-xl bg-[#181819] text-white text-sm font-semibold hover:bg-black transition-colors shadow-sm"
            >
              Upgrade
            </Link>
            {user && user.id !== "local" && user.readiness && (
              <div className="flex items-center gap-2">
                <Tooltip
                  title={READINESS_STAGE_LABEL[user.readiness.stage] ?? user.readiness.stage}
                  description="Уровень готовности к собеседованиям по результатам активности в приложении."
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
                    title="Серия дней"
                    description="Сколько дней подряд вы заходили в приложение. Регулярность повышает уровень готовности."
                    side="bottom"
                  >
                    <div className="flex items-center gap-2 rounded-full bg-[#F5F6FA] border border-[#EBEDF5] px-3 py-1.5 cursor-default hover:bg-[#EBEDF5] transition-colors">
                      <FireIcon className="w-4 h-4 shrink-0 text-[#4578FC]" />
                      <span className="text-sm font-medium tabular-nums text-[#181819]">{user.readiness.streak_days}</span>
                    </div>
                  </Tooltip>
                )}
                <button
                  type="button"
                  className="p-1.5 rounded-full bg-[#F5F6FA] border border-[#EBEDF5] text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] transition-colors"
                  title="Уведомления"
                  aria-label="Уведомления"
                >
                  <BellIcon className="w-5 h-5" />
                </button>
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
