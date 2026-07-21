import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  DocumentTextIcon,
  Cog6ToothIcon,
  HomeIcon,
  ArrowRightOnRectangleIcon,
  UserPlusIcon,
  FireIcon,
  ShieldCheckIcon,
  Bars3Icon,
  XMarkIcon,
  SparklesIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "./contexts/AuthContext";
import { isAdminUser } from "./api";
import {
  READINESS_STAGE_LABEL,
  READINESS_STAGE_ICON_STYLE,
  READINESS_STAGE_ICON_IMAGE,
} from "./readiness";
import { t } from "./i18n";
import { NotificationMenu } from "./components/NotificationMenu";
import RouteFallback from "./components/RouteFallback";
import AdminPipelineConsole from "./components/AdminPipelineConsole";

/** One-time “welcome partner” banner after admin enables `partner_program_access`; cleared when access revoked. */
const PARTNER_WELCOME_ACK_KEY = "pitchcv_partner_welcome_ack_user_id";

/** Resume work surfaces — sidebar auto-compacts to an icon rail. */
function isWorkFocusPath(pathname: string): boolean {
  return (
    pathname === "/improve" ||
    pathname.startsWith("/improve/") ||
    pathname === "/optimize" ||
    pathname.startsWith("/optimize/") ||
    pathname === "/vacancies" ||
    pathname.startsWith("/vacancies/")
  );
}

const nav = [
  { to: "/", label: t("nav.home"), icon: HomeIcon },
  { to: "/improve", label: t("nav.improve"), icon: SparklesIcon },
  { to: "/history", label: t("nav.history"), icon: DocumentTextIcon },
];

export default function Layout() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [partnerWelcomeOpen, setPartnerWelcomeOpen] = useState(false);
  /** On work-focus routes user can temporarily expand the rail. */
  const [workSidebarExpanded, setWorkSidebarExpanded] = useState(false);

  const workFocus = useMemo(() => isWorkFocusPath(location.pathname), [location.pathname]);
  const compactSidebar = workFocus && !workSidebarExpanded && !mobileMenuOpen;

  useEffect(() => {
    setWorkSidebarExpanded(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!user || user.id === "local") {
      setPartnerWelcomeOpen(false);
      return;
    }
    if (!user.partner_program_access) {
      try {
        if (localStorage.getItem(PARTNER_WELCOME_ACK_KEY) === user.id) {
          localStorage.removeItem(PARTNER_WELCOME_ACK_KEY);
        }
      } catch {
        /* private mode */
      }
      setPartnerWelcomeOpen(false);
      return;
    }
    const onPartnerPage = location.pathname === "/partner" || location.pathname.startsWith("/partner/");
    try {
      if (onPartnerPage) {
        localStorage.setItem(PARTNER_WELCOME_ACK_KEY, user.id);
        setPartnerWelcomeOpen(false);
        return;
      }
      const ack = localStorage.getItem(PARTNER_WELCOME_ACK_KEY);
      setPartnerWelcomeOpen(ack !== user.id);
    } catch {
      setPartnerWelcomeOpen(true);
    }
  }, [user, location.pathname]);

  const dismissPartnerWelcome = useCallback(() => {
    if (!user || user.id === "local") return;
    try {
      localStorage.setItem(PARTNER_WELCOME_ACK_KEY, user.id);
    } catch {
      /* private mode */
    }
    setPartnerWelcomeOpen(false);
  }, [user]);

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

  const navItemClass = (active: boolean) =>
    `ds-nav-item ${compactSidebar ? "ds-nav-item-compact" : ""} ${active ? "ds-nav-item-active" : ""}`;

  const sidebarContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`ds-sandbox-aside-brand ${compactSidebar ? "!justify-center !px-0" : ""}`}>
        <span className="ds-sandbox-aside-brand-mark" aria-hidden>
          <img src="/logo-color.svg" alt="" className="w-5 h-5 object-contain" />
        </span>
        {!compactSidebar && (
          <div>
            <div className="font-semibold text-[length:var(--text-base)] tracking-tight text-[var(--text)]">PitchCV</div>
          </div>
        )}
      </div>

      <nav className="space-y-1">
        {nav.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              onClick={closeMobileMenu}
              className={navItemClass(active)}
              title={compactSidebar ? label : undefined}
            >
              <Icon className="w-5 h-5 shrink-0 opacity-100" />
              {!compactSidebar && label}
            </Link>
          );
        })}
        {user && isAdminUser(user) && (
          <Link
            to="/admin"
            onClick={closeMobileMenu}
            className={navItemClass(location.pathname.startsWith("/admin"))}
            title={compactSidebar ? "Admin" : undefined}
          >
            <ShieldCheckIcon className="w-5 h-5 shrink-0 opacity-100" />
            {!compactSidebar && "Admin"}
          </Link>
        )}
      </nav>

      {user && isAdminUser(user) && <AdminPipelineConsole compact={compactSidebar} light />}

      <div className={`mt-auto pt-4 border-t border-[var(--border)] space-y-1 ${compactSidebar ? "flex flex-col items-center" : ""}`}>
        {user?.partner_program_access && (
          <Link
            to="/partner"
            onClick={closeMobileMenu}
            className={`${navItemClass(location.pathname === "/partner")} ${compactSidebar ? "" : "!py-2 !text-[length:var(--text-xs)]"}`}
            title={compactSidebar ? t("nav.inviteFriends") : undefined}
          >
            <UserPlusIcon className={`${compactSidebar ? "w-5 h-5" : "w-4 h-4"} shrink-0 opacity-90`} />
            {!compactSidebar && <span className="truncate">{t("nav.inviteFriends")}</span>}
          </Link>
        )}
        <Link
          to="/settings"
          onClick={closeMobileMenu}
          className={`${navItemClass(location.pathname === "/settings")} ${compactSidebar ? "" : "!py-2 !text-[length:var(--text-xs)]"}`}
          title={compactSidebar ? t("nav.settings") : undefined}
        >
          <Cog6ToothIcon className={`${compactSidebar ? "w-5 h-5" : "w-4 h-4"} shrink-0 opacity-90`} />
          {!compactSidebar && t("nav.settings")}
        </Link>
      </div>

      <div className={`pt-4 mt-4 border-t border-[var(--border)] ${compactSidebar ? "flex flex-col items-center gap-2" : ""}`}>
        {user && user.id !== "local" ? (
          compactSidebar ? (
            <>
              <div
                className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] text-sm font-medium shrink-0"
                title={user.name || user.email}
              >
                {user.name ? user.name.slice(0, 2).toUpperCase() : user.email.slice(0, 2).toUpperCase()}
              </div>
              <NotificationMenu variant="sidebar" />
              <button
                type="button"
                onClick={logout}
                className="shrink-0 p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)] transition-colors"
                title={t("nav.logout")}
                aria-label={t("nav.logout")}
              >
                <ArrowRightOnRectangleIcon className="w-5 h-5" />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] text-sm font-medium shrink-0">
                {user.name ? user.name.slice(0, 2).toUpperCase() : user.email.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text)] truncate">{user.name || user.email.split("@")[0]}</p>
                <p className="text-xs text-[var(--text-tertiary)] truncate">{user.email}</p>
              </div>
              <NotificationMenu variant="sidebar" />
              <button
                type="button"
                onClick={logout}
                className="shrink-0 p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)] transition-colors"
                title={t("nav.logout")}
                aria-label={t("nav.logout")}
              >
                <ArrowRightOnRectangleIcon className="w-5 h-5" />
              </button>
            </div>
          )
        ) : (
          !compactSidebar && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--text-tertiary)] text-sm shrink-0">
                👤
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text)]">{t("nav.localMode")}</p>
                <p className="text-xs text-[var(--text-tertiary)]">{t("nav.noAccount")}</p>
              </div>
            </div>
          )
        )}
      </div>

      {!compactSidebar && user && user.id !== "local" && user.readiness && (
        <div className="mt-5 space-y-2">
          <h3 className="ds-label px-1">{t("nav.yourProgress")}</h3>
          <Link
            to="/progress"
            onClick={closeMobileMenu}
            className="block rounded-xl p-3.5 ds-card transition-all hover:opacity-95 focus:opacity-95 outline-none group"
            aria-label={t("nav.goToProgress")}
          >
            <div className="flex items-center gap-3 mb-2.5">
              {READINESS_STAGE_ICON_IMAGE[user.readiness.stage] ? (
                <img
                  src={READINESS_STAGE_ICON_IMAGE[user.readiness.stage]}
                  alt=""
                  className="block w-6 h-6 object-contain shrink-0"
                />
              ) : (
                <span
                  className="block w-6 h-6 shrink-0"
                  style={READINESS_STAGE_ICON_STYLE[user.readiness.stage] ?? READINESS_STAGE_ICON_STYLE.Emerging}
                />
              )}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[13px] font-bold text-[var(--text)] leading-tight truncate group-hover:text-[var(--accent)] transition-colors">
                  {READINESS_STAGE_LABEL[user.readiness.stage] ?? user.readiness.stage}
                </span>
                <span className="text-[11px] font-semibold text-[var(--text-muted)] mt-0.5">
                  {t("nav.toNextLevel")} {Math.round(user.readiness.progress_to_next * 100)}%
                </span>
              </div>
              {user.readiness.streak_days > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[11px] font-semibold tabular-nums text-[var(--accent)] shrink-0"
                  title={t("nav.streakTooltip")}
                >
                  <FireIcon className="w-3.5 h-3.5" />
                  {user.readiness.streak_days}
                </span>
              )}
            </div>
            <div
              className="ds-progress-track"
              role="progressbar"
              aria-valuenow={Math.round(user.readiness.progress_to_next * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="ds-progress-fill ds-progress-fill--success h-full"
                style={{ width: `${Math.round(user.readiness.progress_to_next * 100)}%` }}
              />
            </div>
          </Link>
        </div>
      )}

      {compactSidebar && user && user.id !== "local" && user.readiness && (
        <Link
          to="/progress"
          onClick={closeMobileMenu}
          className="mt-3 mx-auto flex h-10 w-10 items-center justify-center rounded-xl ds-card hover:opacity-95"
          title={t("nav.goToProgress")}
          aria-label={t("nav.goToProgress")}
        >
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
        </Link>
      )}

      {workFocus && (
        <button
          type="button"
          onClick={() => setWorkSidebarExpanded((v) => !v)}
          className={`mt-3 inline-flex items-center justify-center rounded-xl border border-[var(--border)] bg-white/80 text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)] transition-colors ${
            compactSidebar ? "mx-auto h-9 w-9" : "w-full h-9 gap-2 text-xs font-semibold"
          }`}
          aria-label={compactSidebar ? "Expand menu" : "Collapse menu"}
          title={compactSidebar ? "Expand menu" : "Collapse menu"}
        >
          {compactSidebar ? (
            <ChevronDoubleRightIcon className="w-4 h-4" />
          ) : (
            <>
              <ChevronDoubleLeftIcon className="w-4 h-4" />
              <span>Compact</span>
            </>
          )}
        </button>
      )}
    </div>
  );

  return (
    <div className="h-screen ds-sandbox-shell bg-[var(--bg-page)] flex overflow-hidden">
      <aside
        className={`ds-sandbox-aside hidden md:flex ${
          compactSidebar ? "w-20 px-2" : "w-64 px-4"
        } shrink-0 flex-col min-h-0 py-6 overflow-y-auto z-20 transition-[width,padding] duration-300 ease-out`}
      >
        {sidebarContent}
      </aside>

      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Mobile menu">
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            onClick={closeMobileMenu}
            aria-label="Close mobile menu overlay"
          />
          <aside
            className="ds-sandbox-aside relative ml-0 h-full w-[86vw] max-w-[320px] flex flex-col py-5 px-4 overflow-auto shadow-2xl z-10"
          >
            <button
              type="button"
              onClick={closeMobileMenu}
              className="absolute right-3 top-3 inline-flex items-center justify-center rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
              aria-label="Close mobile menu"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main column — no app header; mobile menu is a floating control */}
      <div
        className={`flex-1 flex flex-col min-w-0 overflow-hidden relative bg-transparent [--app-sidebar-width:0px] [--app-header-height:0px] ${
          compactSidebar ? "md:[--app-sidebar-width:5rem]" : "md:[--app-sidebar-width:16rem]"
        }`}
      >
        <button
          type="button"
          className="md:hidden fixed top-3 left-3 z-30 inline-flex items-center justify-center rounded-xl border border-[var(--border)] bg-white/90 p-2 text-[var(--text)] shadow-sm backdrop-blur-md hover:bg-[var(--accent-soft)]"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open mobile menu"
        >
          <Bars3Icon className="w-6 h-6" />
        </button>

        {partnerWelcomeOpen && user && user.id !== "local" && (
          <div
            className="shrink-0 border-b border-[var(--success-soft)] px-4 py-3 md:px-6 md:pl-6 pl-14"
            style={{ background: "var(--grad-success-soft)" }}
            role="status"
            aria-live="polite"
          >
            <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--success)]">{t("partner.welcomeBannerTitle")}</p>
                <p className="mt-1 text-[13px] leading-snug text-[var(--text-muted)]">{t("partner.welcomeBannerBody")}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <Link
                  to="/partner"
                  onClick={dismissPartnerWelcome}
                  className="ds-btn-primary !px-4 !py-2 !text-[13px]"
                >
                  {t("partner.welcomeBannerCta")}
                </Link>
                <button
                  type="button"
                  onClick={dismissPartnerWelcome}
                  className="inline-flex items-center justify-center rounded-xl border border-[var(--border)] bg-white/90 px-4 py-2 text-[13px] font-semibold text-[var(--text)] transition hover:bg-white"
                >
                  {t("partner.welcomeBannerDismiss")}
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="ds-sandbox-main flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain !pt-14 md:!pt-4 !px-3 md:!px-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px)+0.75rem)] md:pb-6">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
