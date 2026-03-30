import { useEffect, useState } from "react";
import { getAdminActivity, type AdminActivityItem } from "../../api";
import AdminPaginationBar from "../../components/admin/AdminPaginationBar";
import { t } from "../../i18n";

const DEFAULT_PAGE_SIZE = 50;

export default function AdminActivity() {
  const [items, setItems] = useState<AdminActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAdminActivity(pageSize, page * pageSize)
      .then((data) => {
        if (!cancelled) {
          setItems(data.items);
          setTotal(data.total);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const maxPage = totalPages - 1;
    if (total > 0 && page > maxPage) setPage(maxPage);
  }, [total, pageSize, page]);

  if (error && !loading && items.length === 0 && total === 0) {
    return (
      <section aria-labelledby="admin-activity-error" className="rounded-xl border border-red-200 bg-red-50/80 p-4 shrink-0">
        <h2 id="admin-activity-error" className="text-sm font-semibold text-red-800">
          {t("admin.activity.loadError")}
        </h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 max-w-6xl w-full mx-auto">
      <header className="shrink-0 space-y-1 mb-3">
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.activity.title")}</h2>
        <p className="text-sm text-[var(--text-muted)]">{t("admin.activity.subtitle")}</p>
        {error && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">
            {error}
          </p>
        )}
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-12" aria-busy="true" aria-live="polite">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-6 text-center text-sm text-[var(--text-muted)] shrink-0">
          {t("admin.activity.empty")}
        </p>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
            <table className="min-w-full divide-y divide-[#EBEDF5] text-sm" role="table" aria-label={t("admin.activity.title")}>
              <thead className="sticky top-0 z-20 bg-[var(--card)] shadow-[0_1px_0_#EBEDF5]">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.activity.date")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.activity.user")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.activity.company")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.activity.jobTitle")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.activity.filename")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.activity.pdf")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EBEDF5]">
                {items.map((row) => (
                  <tr key={`${row.filename}-${row.created_at}`} className="hover:bg-[#F5F6FA]/50">
                    <td className="px-4 py-3 text-[var(--text-tertiary)] tabular-nums whitespace-nowrap align-top">
                      {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)] truncate max-w-[200px] align-top" title={row.user_email ?? undefined}>
                      {row.user_email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--text)] truncate max-w-[160px] align-top" title={row.company}>
                      {row.company || "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--text)] truncate max-w-[200px] align-top" title={row.job_title}>
                      {row.job_title || "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)] truncate max-w-[220px] font-mono text-xs align-top" title={row.filename}>
                      {row.filename}
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      {row.pdf_on_disk === false ? (
                        <span className="text-amber-600 text-xs font-medium">{t("admin.activity.pdfNo")}</span>
                      ) : (
                        <span className="text-emerald-600 text-xs font-medium">{t("admin.activity.pdfYes")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminPaginationBar
            page={page}
            pageSize={pageSize}
            total={total}
            disabled={loading}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setPage(0);
              setPageSize(n);
            }}
          />
        </div>
      )}
    </div>
  );
}
