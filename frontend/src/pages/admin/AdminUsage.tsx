import { useEffect, useState } from "react";
import { getAdminUsageAudit, type AdminUsageAuditItem } from "../../api";
import { t } from "../../i18n";

export default function AdminUsage() {
  const [items, setItems] = useState<AdminUsageAuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminUsageAudit(500)
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50/80 p-4">
        <h2 className="text-sm font-semibold text-red-800">{t("admin.usage.loadError")}</h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 max-w-6xl w-full mx-auto">
      <header className="shrink-0 mb-3">
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.usage.title")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">{t("admin.usage.subtitle")}</p>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-12" aria-busy="true">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-6 text-center text-sm text-[var(--text-muted)] shrink-0">
          {t("admin.usage.empty")}
        </p>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
            <table className="min-w-full divide-y divide-[#EBEDF5] text-sm">
              <thead className="sticky top-0 z-20 bg-[var(--card)] shadow-[0_1px_0_#EBEDF5]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] whitespace-nowrap">{t("admin.usage.date")}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] whitespace-nowrap">{t("admin.usage.user")}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] whitespace-nowrap">{t("admin.usage.action")}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] whitespace-nowrap">{t("admin.usage.model")}</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-[var(--text-muted)] tabular-nums whitespace-nowrap">{t("admin.usage.tokensIn")}</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-[var(--text-muted)] tabular-nums whitespace-nowrap">{t("admin.usage.tokensOut")}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] whitespace-nowrap">{t("admin.usage.status")}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] min-w-[180px]">{t("admin.usage.error")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EBEDF5]">
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-[#F5F6FA]/50 align-top">
                  <td className="px-3 py-2 text-[var(--text-tertiary)] tabular-nums whitespace-nowrap text-xs">
                    {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)] truncate max-w-[140px]" title={row.user_email ?? undefined}>
                    {row.user_email ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--text)]">{row.action}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)] truncate max-w-[120px]" title={row.model ?? undefined}>
                    {row.model ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{row.input_tokens}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{row.output_tokens}</td>
                  <td className="px-3 py-2">
                    <span className={row.success ? "text-emerald-600 text-xs font-medium" : "text-red-600 text-xs font-medium"}>
                      {row.success ? t("admin.usage.ok") : t("admin.usage.fail")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-red-700 break-words max-w-[280px]">
                    {row.error_message ?? (Object.keys(row.metadata || {}).length ? JSON.stringify(row.metadata) : "")}
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
