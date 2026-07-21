import { Suspense, useCallback, useEffect, useState, type ComponentType } from "react";
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
  BeakerIcon,
  PhotoIcon,
  Bars3Icon,
  XMarkIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ChevronDownIcon,
  EnvelopeIcon,
  FunnelIcon,
  DocumentTextIcon,
  WrenchScrewdriverIcon,
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "./contexts/AuthContext";
import { t } from "./i18n";
import RouteFallback from "./components/RouteFallback";
import AdminPipelineConsole from "./components/AdminPipelineConsole";
import { AdminSandboxShellProvider, useAdminSandboxShell } from "./AdminSandboxShellContext";

const ADMIN_NAV_GROUPS_STORAGE = "admin_nav_groups_open_v1";

type IconComp = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

type AdminNavLinkDef = {
  to: string;
  end?: boolean;
  labelKey: string;
  icon: IconComp;
};

type AdminNavLinkEntry = {
  kind: "link";
  to: string;
  end?: boolean;
  labelKey: string;
  icon: IconComp;
};

type AdminNavGroupEntry = {
  kind: "group";
  id: string;
  labelKey: string;
  icon: IconComp;
  items: AdminNavLinkDef[];
};

type AdminNavEntry = AdminNavLinkEntry | AdminNavGroupEntry;

const ADMIN_NAV: AdminNavEntry[] = [
  { kind: "link", to: "/admin", end: true, labelKey: "admin.nav.dashboard", icon: ChartBarIcon },
  {
    kind: "group",
    id: "userManagement",
    labelKey: "admin.nav.folderUserManagement",
    icon: UserGroupIcon,
    items: [
      { to: "/admin/users", labelKey: "admin.nav.users", icon: UserGroupIcon },
      { to: "/admin/reviews", labelKey: "admin.nav.reviews", icon: ChatBubbleLeftRightIcon },
      { to: "/admin/activity", labelKey: "admin.nav.activity", icon: ClockIcon },
      { to: "/admin/usage", labelKey: "admin.nav.usage", icon: CpuChipIcon },
      { to: "/admin/referrals", labelKey: "admin.nav.referrals", icon: UserPlusIcon },
    ],
  },
  {
    kind: "group",
    id: "labs",
    labelKey: "admin.nav.folderLabs",
    icon: BeakerIcon,
    items: [
      { to: "/admin/templates-lab", labelKey: "admin.nav.templatesLab", icon: BeakerIcon },
      { to: "/admin/visual", labelKey: "admin.nav.visual", icon: PhotoIcon },
    ],
  },
  {
    kind: "group",
    id: "email",
    labelKey: "admin.nav.folderEmail",
    icon: EnvelopeIcon,
    items: [
      { to: "/admin/email/send", labelKey: "admin.nav.emailAutomation", icon: PaperAirplaneIcon },
      { to: "/admin/email/groups", labelKey: "admin.nav.emailGroups", icon: FunnelIcon },
      { to: "/admin/email/templates", labelKey: "admin.nav.emailTemplates", icon: DocumentTextIcon },
    ],
  },
  {
    kind: "group",
    id: "system",
    labelKey: "admin.nav.folderSystem",
    icon: WrenchScrewdriverIcon,
    items: [
      { to: "/admin/config", labelKey: "admin.nav.config", icon: AdjustmentsHorizontalIcon },
      { to: "/admin/app", labelKey: "admin.nav.app", icon: Cog6ToothIcon },
    ],
  },
];

function pathMatchesItem(pathname: string, to: string, end?: boolean): boolean {
  if (end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

function loadGroupOpenState(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(ADMIN_NAV_GROUPS_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, boolean>;
  } catch {
    /* ignore */
  }
  return {};
}

function persistGroupOpenState(next: Record<string, boolean>) {
  try {
    window.localStorage.setItem(ADMIN_NAV_GROUPS_STORAGE, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function groupHasActiveChild(pathname: string, g: AdminNavGroupEntry): boolean {
  return g.items.some((item) => pathMatchesItem(pathname, item.to, item.end));
}

function AdminLayoutInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const { user } = useAuth();
  const { isSandboxRoute, sidebarHidden, setForceShowSidebar, studioFocus } =
    useAdminSandboxShell();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean | undefined>>(() => loadGroupOpenState());

  useEffect(() => {
    const saved = window.localStorage.getItem("admin_sidebar_collapsed");
    setSidebarCollapsed(saved === "1");
  }, []);

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

  /** When entering studio focus, close mobile drawer. */
  useEffect(() => {
    if (sidebarHidden) setMobileMenuOpen(false);
  }, [sidebarHidden]);

  const closeMobileMenu = () => setMobileMenuOpen(false);
  /** Light sandbox chrome is default for all admin routes; compact collapse always allowed. */
  const compactSidebar = sidebarCollapsed && !mobileMenuOpen;

  const toggleGroup = useCallback(
    (id: string) => {
      setGroupOpen((prev) => {
        const g = ADMIN_NAV.find((e): e is AdminNavGroupEntry => e.kind === "group" && e.id === id);
        if (!g) return prev;
        const routeDefault = groupHasActiveChild(pathname, g);
        const prevExplicit = prev[id];
        const currentlyOpen = prevExplicit !== undefined ? prevExplicit : routeDefault;
        const next = { ...prev, [id]: !currentlyOpen };
        const persistable: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(next)) {
          if (v !== undefined) persistable[k] = Boolean(v);
        }
        persistGroupOpenState(persistable);
        return next;
      });
    },
    [pathname],
  );

  /** Visual language from sandbox applied to every admin page (focus/portal still gated by isSandboxRoute). */
  const sandbox = true;

  const linkClass = ({ isActive }: { isActive: boolean }) => {
    if (sandbox) {
      return `ds-nav-item ${compactSidebar ? "ds-nav-item-compact" : ""} ${isActive ? "ds-nav-item-active" : ""}`;
    }
    return `flex items-center ${compactSidebar ? "justify-center" : "gap-3"} px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      isActive ? "bg-white/20 text-white shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white"
    }`;
  };

  const sidebarContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={sandbox ? "ds-sandbox-aside-brand" : "flex items-center gap-2 mb-8 px-2"}>
        <span
          className={
            sandbox
              ? "ds-sandbox-aside-brand-mark"
              : "flex h-9 w-9 items-center justify-center rounded-lg bg-white/15"
          }
          aria-hidden
        >
          <ShieldCheckIcon className="w-5 h-5" />
        </span>
        {!compactSidebar && (
          <div>
            <div className="flex items-center gap-2">
              <img
                src={sandbox ? "/logo-color.svg" : "/logo-white.svg"}
                alt=""
                className="w-6 h-6 object-contain shrink-0"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
              <div
                className={
                  sandbox
                    ? "font-semibold text-[length:var(--text-base)] tracking-tight text-[var(--text)]"
                    : "font-bold text-lg tracking-tight drop-shadow-sm"
                }
              >
                PitchCV
              </div>
            </div>
            <div
              className={
                sandbox
                  ? "ds-label mt-0.5"
                  : "text-[11px] font-medium text-white/70 uppercase tracking-wider"
              }
            >
              {t("admin.badge")}
            </div>
          </div>
        )}
      </div>

      <nav className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-y-auto overscroll-y-contain">
        {ADMIN_NAV.map((entry, navIndex) => {
          if (entry.kind === "link") {
            const label = t(entry.labelKey);
            const Icon = entry.icon;
            return (
              <div
                key={entry.to}
                className={
                  navIndex > 0
                    ? sandbox
                      ? "mt-2 border-t border-[var(--border)] pt-2"
                      : "mt-2 border-t border-white/10 pt-2"
                    : ""
                }
              >
                <NavLink
                  to={entry.to}
                  end={entry.end}
                  onClick={closeMobileMenu}
                  className={linkClass}
                  title={compactSidebar ? label : undefined}
                >
                  <Icon className="w-5 h-5 shrink-0 opacity-100" aria-hidden />
                  {!compactSidebar && <span className="min-w-0 truncate">{label}</span>}
                </NavLink>
              </div>
            );
          }

          const g = entry;
          const folderLabel = t(g.labelKey);
          const explicit = groupOpen[g.id];
          const open = explicit !== undefined ? explicit : groupHasActiveChild(pathname, g);
          const FolderIcon = g.icon;

          if (compactSidebar) {
            return (
              <div
                key={g.id}
                className={
                  sandbox
                    ? "mt-2 border-t border-[var(--border)] pt-2 space-y-0.5"
                    : "mt-2 border-t border-white/10 pt-2 space-y-0.5"
                }
              >
                {g.items.map(({ to, end, labelKey, icon: Icon }) => {
                  const label = t(labelKey);
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      onClick={closeMobileMenu}
                      className={linkClass}
                      title={`${folderLabel} · ${label}`}
                    >
                      <Icon className="w-5 h-5 shrink-0 opacity-100" aria-hidden />
                    </NavLink>
                  );
                })}
              </div>
            );
          }

          const childListId = `admin-nav-sub-${g.id}`;
          return (
            <div
              key={g.id}
              className={sandbox ? "mt-2 border-t border-[var(--border)] pt-2" : "mt-2 border-t border-white/10 pt-2"}
            >
              <button
                type="button"
                onClick={() => toggleGroup(g.id)}
                aria-expanded={open}
                aria-controls={childListId}
                className={
                  sandbox
                    ? `ds-nav-item w-full text-left ${groupHasActiveChild(pathname, g) ? "ds-nav-item-active" : ""}`
                    : `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                        groupHasActiveChild(pathname, g)
                          ? "bg-white/15 text-white"
                          : "text-white/90 hover:bg-white/10 hover:text-white"
                      }`
                }
              >
                <FolderIcon className="h-5 w-5 shrink-0 opacity-100" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{folderLabel}</span>
                <ChevronDownIcon
                  className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""} ${
                    sandbox ? "text-[var(--text-tertiary)]" : "text-white/80"
                  }`}
                  aria-hidden
                />
              </button>
              {open && (
                <ul
                  id={childListId}
                  className={
                    sandbox
                      ? "ml-2 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-2"
                      : "ml-2 mt-0.5 space-y-0.5 border-l border-white/20 pl-2"
                  }
                  role="list"
                >
                  {g.items.map(({ to, end, labelKey, icon: Icon }) => {
                    const label = t(labelKey);
                    return (
                      <li key={to}>
                        <NavLink
                          to={to}
                          end={end}
                          onClick={closeMobileMenu}
                          className={({ isActive }) =>
                            sandbox
                              ? `ds-nav-item !rounded-[var(--radius-md)] !py-2 !pl-2 ${isActive ? "ds-nav-item-active" : ""}`
                              : `flex items-center gap-2.5 rounded-lg py-2 pl-2 pr-2 text-sm font-medium transition-colors ${
                                  isActive
                                    ? "bg-white/20 text-white shadow-sm"
                                    : "text-white/85 hover:bg-white/10 hover:text-white"
                                }`
                          }
                        >
                          <Icon className="h-4 w-4 shrink-0 opacity-100" aria-hidden />
                          <span className="min-w-0 truncate">{label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {user && <AdminPipelineConsole compact={compactSidebar} light />}

      <div
        className={
          sandbox
            ? "mt-auto pt-4 border-t border-[var(--border)]"
            : "mt-auto pt-4 border-t border-white/15"
        }
      >
        <button
          type="button"
          onClick={() => {
            closeMobileMenu();
            navigate("/");
          }}
          className={
            sandbox
              ? `ds-nav-item w-full ${compactSidebar ? "ds-nav-item-compact" : ""}`
              : `w-full flex items-center ${compactSidebar ? "justify-center" : "gap-2.5"} px-3 py-2 rounded-lg text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors`
          }
          title={compactSidebar ? t("admin.backToApp") : undefined}
        >
          <HomeIcon className="w-4 h-4 shrink-0" aria-hidden />
          {!compactSidebar && t("admin.backToApp")}
        </button>
      </div>

      {user && !compactSidebar && (
        <div
          className={
            sandbox
              ? "pt-4 mt-4 border-t border-[var(--border)]"
              : "pt-4 mt-4 border-t border-white/15"
          }
        >
          <p
            className={
              sandbox
                ? "ds-label px-1"
                : "text-[11px] font-semibold text-white/70 uppercase tracking-wider px-1"
            }
          >
            {t("admin.signedInAs")}
          </p>
          <p
            className={
              sandbox
                ? "text-sm font-medium text-[var(--text)] truncate mt-1 px-1"
                : "text-sm font-medium text-white truncate mt-1 px-1"
            }
            title={user.email}
          >
            {user.email}
          </p>
        </div>
      )}
    </div>
  );

  const showDesktopAside = !sidebarHidden;

  return (
    <div
      className={`h-screen flex overflow-hidden ${sandbox ? "ds-sandbox-shell bg-[var(--bg-page)]" : "bg-[var(--bg-page)]"}`}
      role="application"
      aria-label={t("admin.panelLabel")}
    >
      {showDesktopAside && (
        <aside
          className={
            sandbox
              ? `ds-sandbox-aside hidden md:flex ${sidebarCollapsed ? "w-20 px-2" : "w-64 px-4"} shrink-0 flex-col min-h-0 py-6 overflow-hidden z-20 transition-all duration-300`
              : `hidden md:flex ${sidebarCollapsed ? "w-20 px-2" : "w-64 px-4"} shrink-0 flex-col min-h-0 py-6 overflow-hidden text-white shadow-xl z-20 transition-all`
          }
          style={sandbox ? undefined : { background: "linear-gradient(160deg, var(--accent) 0%, var(--accent-hover) 100%)" }}
          role="navigation"
          aria-label={t("admin.navLabel")}
        >
          {sidebarContent}
        </aside>
      )}

      {mobileMenuOpen && !sidebarHidden && (
        <div className="md:hidden fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label={t("admin.navLabel")}>
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            onClick={closeMobileMenu}
            aria-label="Close admin mobile menu overlay"
          />
          <aside
            className={
              sandbox
                ? "ds-sandbox-aside relative ml-0 h-full w-[86vw] max-w-[320px] flex flex-col py-5 px-4 overflow-auto shadow-2xl z-10"
                : "relative ml-0 h-full w-[86vw] max-w-[320px] flex flex-col py-5 px-4 overflow-auto text-white shadow-2xl z-10"
            }
            style={sandbox ? undefined : { background: "linear-gradient(160deg, var(--accent) 0%, var(--accent-hover) 100%)" }}
            role="navigation"
            aria-label={t("admin.navLabel")}
          >
            <button
              type="button"
              onClick={closeMobileMenu}
              className={
                sandbox
                  ? "absolute right-3 top-3 inline-flex items-center justify-center rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
                  : "absolute right-3 top-3 inline-flex items-center justify-center rounded-lg p-1.5 text-white/90 hover:bg-white/15 hover:text-white"
              }
              aria-label="Close admin mobile menu"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-transparent">
        <header
          className={
            sandbox
              ? "ds-sandbox-header shrink-0 flex items-center justify-between px-4 md:px-6 h-14 z-10 gap-3"
              : "shrink-0 bg-[var(--card)] border-b border-[#EBEDF5] flex items-center justify-between px-4 md:px-6 h-14 z-10 gap-3"
          }
        >
          <div className="flex items-center gap-2 shrink-0">
            {sandbox && studioFocus ? (
              sidebarHidden ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--border)] bg-white/80 px-3 py-1.5 text-[length:var(--text-xs)] font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] hover:bg-white"
                  onClick={() => setForceShowSidebar(true)}
                  aria-label="Show menu"
                >
                  <Bars3Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">Menu</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--border)] bg-white/80 px-3 py-1.5 text-[length:var(--text-xs)] font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] hover:bg-white"
                  onClick={() => {
                    setForceShowSidebar(false);
                    setMobileMenuOpen(false);
                  }}
                  aria-label="Hide menu"
                  title="Hide menu"
                >
                  <ChevronDoubleLeftIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Hide</span>
                </button>
              )
            ) : (
              <button
                type="button"
                className={
                  sandbox
                    ? "md:hidden inline-flex items-center justify-center rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
                    : "md:hidden inline-flex items-center justify-center rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[#F5F6FA] hover:text-[#181819]"
                }
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open admin mobile menu"
              >
                <Bars3Icon className="w-6 h-6" />
              </button>
            )}
          </div>

          {isSandboxRoute ? (
            <div id="admin-header-portal" className="flex-1 flex items-center min-w-0" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-[var(--text)]">{t("admin.title")}</h1>
                <button
                  type="button"
                  className="hidden md:inline-flex rounded-lg border border-[#EBEDF5] p-1.5 text-[var(--text-muted)] hover:bg-[#F5F6FA]"
                  onClick={() => {
                    const next = !sidebarCollapsed;
                    setSidebarCollapsed(next);
                    window.localStorage.setItem("admin_sidebar_collapsed", next ? "1" : "0");
                  }}
                  aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {sidebarCollapsed ? (
                    <ChevronDoubleRightIcon className="w-4 h-4" />
                  ) : (
                    <ChevronDoubleLeftIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
              <div className="md:hidden w-6 shrink-0" aria-hidden />
            </>
          )}
        </header>

        <main
          className={
            sandbox
              ? "ds-sandbox-main flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain"
              : "flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pt-3 md:pt-4 pb-6 md:pb-8 px-3 md:px-6 overscroll-y-contain"
          }
          role="main"
        >
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  const location = useLocation();
  const isSandboxRoute = location.pathname.includes("/admin/visual");

  return (
    <AdminSandboxShellProvider isSandboxRoute={isSandboxRoute}>
      <AdminLayoutInner />
    </AdminSandboxShellProvider>
  );
}
