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

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const { user } = useAuth();
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

  const closeMobileMenu = () => setMobileMenuOpen(false);
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
    [pathname]
  );

  const sidebarContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 mb-8 px-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15" aria-hidden>
          <ShieldCheckIcon className="w-5 h-5" />
        </span>
        {!compactSidebar && (
          <div>
            <div className="flex items-center gap-2">
              <img src="/logo-white.svg" alt="" className="w-6 h-6 object-contain shrink-0" />
              <div className="font-bold text-lg tracking-tight drop-shadow-sm">PitchCV</div>
            </div>
            <div className="text-[11px] font-medium text-white/70 uppercase tracking-wider">{t("admin.badge")}</div>
          </div>
        )}
      </div>

      <nav className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-y-auto overscroll-y-contain">
        {ADMIN_NAV.map((entry, navIndex) => {
          if (entry.kind === "link") {
            const label = t(entry.labelKey);
            const Icon = entry.icon;
            return (
              <div key={entry.to} className={navIndex > 0 ? "mt-2 border-t border-white/10 pt-2" : ""}>
                <NavLink
                  to={entry.to}
                  end={entry.end}
                  onClick={closeMobileMenu}
                  className={({ isActive }) =>
                    `flex items-center ${compactSidebar ? "justify-center" : "gap-3"} px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      isActive ? "bg-white/20 text-white shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white"
                    }`
                  }
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
              <div key={g.id} className="mt-2 border-t border-white/10 pt-2 space-y-0.5">
                {g.items.map(({ to, end, labelKey, icon: Icon }) => {
                  const label = t(labelKey);
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      onClick={closeMobileMenu}
                      className={({ isActive }) =>
                        `flex items-center justify-center px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                          isActive ? "bg-white/20 text-white shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white"
                        }`
                      }
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
            <div key={g.id} className="mt-2 border-t border-white/10 pt-2">
              <button
                type="button"
                onClick={() => toggleGroup(g.id)}
                aria-expanded={open}
                aria-controls={childListId}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  groupHasActiveChild(pathname, g) ? "bg-white/15 text-white" : "text-white/90 hover:bg-white/10 hover:text-white"
                }`}
              >
                <FolderIcon className="h-5 w-5 shrink-0 opacity-100" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{folderLabel}</span>
                <ChevronDownIcon
                  className={`h-4 w-4 shrink-0 text-white/80 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              {open && (
                <ul id={childListId} className="ml-2 mt-0.5 space-y-0.5 border-l border-white/20 pl-2" role="list">
                  {g.items.map(({ to, end, labelKey, icon: Icon }) => {
                    const label = t(labelKey);
                    return (
                      <li key={to}>
                        <NavLink
                          to={to}
                          end={end}
                          onClick={closeMobileMenu}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 rounded-lg py-2 pl-2 pr-2 text-sm font-medium transition-colors ${
                              isActive ? "bg-white/20 text-white shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white"
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

      {user && <AdminPipelineConsole compact={compactSidebar} />}

      <div className="mt-auto pt-4 border-t border-white/15">
        <button
          type="button"
          onClick={() => {
            closeMobileMenu();
            navigate("/");
          }}
          className={`w-full flex items-center ${compactSidebar ? "justify-center" : "gap-2.5"} px-3 py-2 rounded-lg text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors`}
          title={compactSidebar ? t("admin.backToApp") : undefined}
        >
          <HomeIcon className="w-4 h-4 shrink-0" aria-hidden />
          {!compactSidebar && t("admin.backToApp")}
        </button>
      </div>

      {user && !compactSidebar && (
        <div className="pt-4 mt-4 border-t border-white/15">
          <p className="text-[11px] font-semibold text-white/70 uppercase tracking-wider px-1">{t("admin.signedInAs")}</p>
          <p className="text-sm font-medium text-white truncate mt-1 px-1" title={user.email}>
            {user.email}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen bg-[var(--bg-page)] flex overflow-hidden" role="application" aria-label={t("admin.panelLabel")}>
      <aside
        className={`hidden md:flex ${sidebarCollapsed ? "w-20 px-2" : "w-64 px-4"} shrink-0 flex-col min-h-0 py-6 overflow-hidden text-white shadow-xl z-20 transition-all`}
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
                  {sidebarCollapsed ? <ChevronDoubleRightIcon className="w-4 h-4" /> : <ChevronDoubleLeftIcon className="w-4 h-4" />}
                </button>
              </div>
              <div className="md:hidden w-6 shrink-0" aria-hidden />
            </>
          )}
        </header>

        <main
          className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pt-3 md:pt-4 pb-6 md:pb-8 px-3 md:px-6 overscroll-y-contain"
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
