import { Link, Outlet, useLocation } from "react-router-dom";
import {
  SparklesIcon,
  DocumentTextIcon,
  Cog6ToothIcon,
  ChevronLeftIcon,
} from "@heroicons/react/24/outline";

const nav = [
  { to: "/history", label: "История", icon: DocumentTextIcon },
  { to: "/settings", label: "Настройки", icon: Cog6ToothIcon },
];

export default function Layout() {
  const location = useLocation();
  const isOptimize = location.pathname === "/";

  return (
    <div className="min-h-screen bg-[#F9F9F9] flex flex-col">
      <header className="shrink-0 mx-4 mt-4 mb-0 rounded-2xl bg-[#FFFFFF] flex items-center justify-between px-6 h-14">
        <div className="font-semibold text-xl text-gray-900 tracking-tight">HR-Breaker</div>
        <div className="w-64 h-9 rounded-xl bg-[#F9F9F9] flex items-center px-3 text-[var(--text-muted)] text-sm">
          Поиск
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#F9F9F9] flex items-center justify-center text-gray-400 text-sm" title="Профиль">
            👤
          </div>
        </div>
      </header>

      <div className="flex flex-1 gap-4 px-4 pb-4 pt-4 min-h-0">
        <aside className="w-52 shrink-0 rounded-2xl bg-[#FFFFFF] flex flex-col py-5 px-3">
          {/* Главная кнопка — современный стиль, чистый градиент, текст в одну строку */}
          <Link
            to="/"
            className={`flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              isOptimize
                ? "bg-gradient-to-r from-[#2E9FFF] to-[#1a7fd9] text-white shadow-sm shadow-[#2E9FFF]/20"
                : "bg-gradient-to-r from-[#2E9FFF] to-[#1a7fd9] text-white shadow-sm shadow-[#2E9FFF]/15 hover:shadow-[#2E9FFF]/25 hover:from-[#3aa8ff] hover:to-[#2E9FFF]"
            }`}
          >
            <SparklesIcon className="w-5 h-5 shrink-0" />
            <span>Улучшить резюме</span>
          </Link>

          <nav className="mt-6 space-y-0.5">
            {nav.map(({ to, label, icon: Icon }) => {
              const active = location.pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    active
                      ? "bg-[#F9F9F9] text-gray-900"
                      : "text-[var(--text-muted)] hover:bg-[#F9F9F9] hover:text-gray-800"
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0 opacity-80" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto pt-4 flex justify-center">
            <button
              type="button"
              className="w-9 h-9 rounded-full bg-[#F9F9F9] text-[var(--text-muted)] flex items-center justify-center hover:bg-[#e8f0fe] hover:text-[#1a73e8] transition-colors"
              title="Свернуть"
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-auto rounded-2xl min-w-0 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
