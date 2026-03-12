import { useEffect, useState } from "react";
import { getAdminConfig } from "../../api";
import { t } from "../../i18n";

export default function AdminApp() {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getAdminConfig>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminConfig()
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });
    return () => { cancelled = true; };
  }, []);

  const apiBase = typeof window !== "undefined" ? `${window.location.origin}/api` : "/api";

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.app.title")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">{t("admin.app.subtitle")}</p>
      </header>

      <section
        className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm"
        aria-labelledby="admin-app-status"
      >
        <h3 id="admin-app-status" className="text-sm font-semibold text-[var(--text)]">
          {t("admin.app.status")}
        </h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {t("admin.app.statusOk")}. {t("admin.app.configNote")}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={`${apiBase}/health`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-[#EBEDF5] bg-[#F5F6FA] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[#EBEDF5] transition-colors"
          >
            {t("admin.app.openHealth")}
          </a>
        </div>
      </section>

      {config && (
        <section
          className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm"
          aria-labelledby="admin-app-summary"
        >
          <h3 id="admin-app-summary" className="text-sm font-semibold text-[var(--text)]">
            Quick summary
          </h3>
          <ul className="mt-3 space-y-1.5 text-sm text-[var(--text-muted)]">
            <li>Database: {config.database_configured ? "✓" : "—"}</li>
            <li>JWT: {config.jwt_configured ? "✓" : "—"}</li>
            <li>Google OAuth: {config.google_oauth_configured ? "✓" : "—"}</li>
            <li>Stripe: {config.stripe_configured ? "✓" : "—"}</li>
            <li>Landing CORS origins: {config.landing_origins_count}</li>
            <li>Adzuna: {config.adzuna_configured ? "✓" : "—"}</li>
          </ul>
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">
            Full config: Admin → Config
          </p>
        </section>
      )}
    </div>
  );
}
