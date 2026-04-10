import { useEffect, useState } from "react";
import {
  getAdminActivity,
  openAdminPdfInNewTab,
  downloadAdminResumeSource,
  type AdminActivityItem,
} from "../../api";
import AdminPaginationBar from "../../components/admin/AdminPaginationBar";
import { t } from "../../i18n";
import { ArrowTopRightOnSquareIcon, DocumentTextIcon } from "@heroicons/react/24/outline";

const DEFAULT_PAGE_SIZE = 50;

function ActivityRow({
  row,
  onActionError,
}: {
  row: AdminActivityItem;
  onActionError: (msg: string | null) => void;
}) {
  const kind =
    row.file_kind === "uploaded"
      ? t("admin.activity.kindUploaded")
      : t("admin.activity.kindGenerated");
  const canOpen = row.pdf_on_disk !== false;

  async function handleOpenPdf() {
    onActionError(null);
    try {
      await openAdminPdfInNewTab(row.filename);
    } catch (e) {
      onActionError(e instanceof Error ? e.message : t("admin.activity.openError"));
    }
  }

  async function handleSource() {
    onActionError(null);
    try {
      await downloadAdminResumeSource(row.filename);
    } catch (e) {
      onActionError(e instanceof Error ? e.message : t("admin.activity.openError"));
    }
  }

  return (
    <tr className="hover:bg-[#F5F6FA]/50">
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
      <td className="px-4 py-3 text-[var(--text-muted)] text-xs align-top whitespace-nowrap">{kind}</td>
      <td className="px-4 py-3 align-top whitespace-nowrap">
        {row.pdf_on_disk === false ? (
          <span className="text-amber-600 text-xs font-medium">{t("admin.activity.pdfNo")}</span>
        ) : (
          <span className="text-emerald-600 text-xs font-medium">{t("admin.activity.pdfYes")}</span>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canOpen}
            onClick={() => void handleOpenPdf()}
            className="inline-flex items-center gap-1 rounded-lg border border-[#E8ECF4] bg-white px-2.5 py-1.5 text-xs font-medium text-[#4578FC] hover:bg-[#F5F8FF] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0" aria-hidden />
            {t("admin.activity.openPdf")}
          </button>
          {row.has_stored_source ? (
            <button
              type="button"
              onClick={() => void handleSource()}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E8ECF4] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[#F5F6FA]"
            >
              <DocumentTextIcon className="h-4 w-4 shrink-0" aria-hidden />
              {t("admin.activity.downloadSource")}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export default function AdminActivity() {
  const [items, setItems] = useState<AdminActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

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
        {actionError && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="status">
            {actionError}
          </p>
        )}
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
                    {t("admin.activity.kind")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.activity.pdf")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.activity.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EBEDF5]">
                {items.map((row) => (
                  <ActivityRow
                    key={`${row.filename}-${row.created_at}`}
                    row={row}
                    onActionError={setActionError}
                  />
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
