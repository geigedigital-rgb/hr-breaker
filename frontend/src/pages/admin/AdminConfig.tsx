import { useEffect, useState } from "react";
import { getAdminConfig, type AdminConfigResponse } from "../../api";
import { t } from "../../i18n";

function ConfigRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string | number;
  ok?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#EBEDF5] last:border-0">
      <span className="text-sm text-[var(--text-muted)]">{label}</span>
      {ok !== undefined ? (
        <span
          className={`text-sm font-medium ${ok ? "text-emerald-600" : "text-[var(--text-tertiary)]"}`}
        >
          {ok ? t("admin.config.configured") : t("admin.config.notConfigured")}
        </span>
      ) : (
        <span className="text-sm font-medium text-[var(--text)] tabular-nums">{value}</span>
      )}
    </div>
  );
}

export default function AdminConfig() {
  const [config, setConfig] = useState<AdminConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminConfig()
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <section aria-labelledby="admin-config-error" className="rounded-xl border border-red-200 bg-red-50/80 p-4">
        <h2 id="admin-config-error" className="text-sm font-semibold text-red-800">
          {t("admin.config.loadError")}
        </h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </section>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center py-12" aria-busy="true" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.config.title")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">{t("admin.config.subtitle")}</p>
      </header>

      <section
        className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm"
        aria-labelledby="admin-config-section"
      >
        <h3 id="admin-config-section" className="sr-only">
          {t("admin.config.title")}
        </h3>
        <div className="space-y-0">
          <ConfigRow label={t("admin.config.database")} value="" ok={config.database_configured} />
          <ConfigRow label={t("admin.config.jwt")} value="" ok={config.jwt_configured} />
          <ConfigRow label={t("admin.config.googleOauth")} value="" ok={config.google_oauth_configured} />
          <ConfigRow label={t("admin.config.stripe")} value="" ok={config.stripe_configured} />
          <ConfigRow label={t("admin.config.adzuna")} value="" ok={config.adzuna_configured} />
          <ConfigRow
            label={t("admin.config.landingOrigins")}
            value={config.landing_origins_count}
          />
          <ConfigRow
            label={t("admin.config.landingRateLimit")}
            value={config.landing_rate_limit_hours}
          />
          <ConfigRow
            label={t("admin.config.landingPendingTtl")}
            value={config.landing_pending_ttl_seconds}
          />
          <ConfigRow label={t("admin.config.maxIterations")} value={config.max_iterations} />
          <ConfigRow label={t("admin.config.frontendUrl")} value={config.frontend_url || "—"} />
        </div>
      </section>
    </div>
  );
}
