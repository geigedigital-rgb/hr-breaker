import { useEffect, useState } from "react";
import { getAdminActivity, type AdminActivityItem } from "../../api";
import { t } from "../../i18n";

export default function AdminActivity() {
  const [items, setItems] = useState<AdminActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminActivity(100)
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
      <section aria-labelledby="admin-activity-error" className="rounded-xl border border-red-200 bg-red-50/80 p-4">
        <h2 id="admin-activity-error" className="text-sm font-semibold text-red-800">
          {t("admin.activity.loadError")}
        </h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </section>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <header>
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.activity.title")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">{t("admin.activity.subtitle")}</p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-12" aria-busy="true" aria-live="polite">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-6 text-center text-sm text-[var(--text-muted)]">
          {t("admin.activity.empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm">
          <table className="min-w-full divide-y divide-[#EBEDF5]" role="table" aria-label={t("admin.activity.title")}>
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.activity.date")}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.activity.user")}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.activity.company")}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.activity.jobTitle")}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.activity.filename")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EBEDF5]">
              {items.map((row) => (
                <tr key={`${row.filename}-${row.created_at}`} className="hover:bg-[#F5F6FA]/50">
                  <td className="px-4 py-3 text-sm text-[var(--text-tertiary)] tabular-nums whitespace-nowrap">
                    {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-muted)] truncate max-w-[180px]" title={row.user_email ?? undefined}>
                    {row.user_email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text)] truncate max-w-[140px]" title={row.company}>
                    {row.company || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text)] truncate max-w-[180px]" title={row.job_title}>
                    {row.job_title || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-tertiary)] truncate max-w-[200px] font-mono text-xs" title={row.filename}>
                    {row.filename}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
