import { useEffect, useState } from "react";
import { getAdminStats } from "../../api";
import { t } from "../../i18n";

type Stats = {
  users_count: number;
  resumes_count: number;
  database: string;
} | null;

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminStats()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <section aria-labelledby="admin-dashboard-error" className="rounded-xl border border-red-200 bg-red-50/80 p-4">
        <h2 id="admin-dashboard-error" className="text-sm font-semibold text-red-800">
          {t("admin.dashboard.loadError")}
        </h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </section>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-12" aria-busy="true" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }

  const dbLabel =
    stats.database === "connected"
      ? t("admin.dashboard.databaseConnected")
      : stats.database === "error"
        ? t("admin.dashboard.databaseError")
        : t("admin.dashboard.databaseDisabled");

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.dashboard.title")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">{t("admin.dashboard.subtitle")}</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" role="list">
        <article
          className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm transition-shadow hover:shadow-md"
          role="listitem"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t("admin.dashboard.users")}
          </p>
          <p className="mt-2 text-2xl font-bold text-[var(--text)] tabular-nums" aria-label={`${stats.users_count} users`}>
            {stats.users_count}
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-tertiary)]">{t("admin.dashboard.usersDesc")}</p>
        </article>

        <article
          className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm transition-shadow hover:shadow-md"
          role="listitem"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t("admin.dashboard.resumes")}
          </p>
          <p className="mt-2 text-2xl font-bold text-[var(--text)] tabular-nums" aria-label={`${stats.resumes_count} resumes`}>
            {stats.resumes_count}
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-tertiary)]">{t("admin.dashboard.resumesDesc")}</p>
        </article>

        <article
          className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm transition-shadow hover:shadow-md"
          role="listitem"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t("admin.dashboard.database")}
          </p>
          <p
            className={`mt-2 text-lg font-bold tabular-nums ${
              stats.database === "connected"
                ? "text-emerald-600"
                : stats.database === "error"
                  ? "text-amber-600"
                  : "text-[var(--text)]"
            }`}
            aria-label={`Database: ${dbLabel}`}
          >
            {dbLabel}
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-tertiary)]">DATABASE_URL</p>
        </article>
      </div>
    </div>
  );
}
