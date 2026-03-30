import { useCallback, useEffect, useState } from "react";
import {
  downloadAdminReviewsCsv,
  getAdminReviews,
  patchAdminReview,
  type AdminReviewRow,
} from "../../api";
import AdminPaginationBar from "../../components/admin/AdminPaginationBar";
import { t } from "../../i18n";

const PAGE_SIZE_DEFAULT = 25;

const STATUS_OPTIONS: { v: string; labelKey: string }[] = [
  { v: "", labelKey: "admin.reviews.filterAll" },
  { v: "pending", labelKey: "admin.reviews.statusPending" },
  { v: "approved", labelKey: "admin.reviews.statusApproved" },
  { v: "rejected", labelKey: "admin.reviews.statusRejected" },
  { v: "hidden", labelKey: "admin.reviews.statusHidden" },
];

export default function AdminReviews() {
  const [items, setItems] = useState<AdminReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [statusFilter, setStatusFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminReviewRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [formStatus, setFormStatus] = useState("pending");
  const [formVerified, setFormVerified] = useState(false);
  const [formPinned, setFormPinned] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rating =
        ratingFilter === "" ? undefined : Number.parseInt(ratingFilter, 10);
      const data = await getAdminReviews({
        limit: pageSize,
        offset: page * pageSize,
        status: statusFilter || undefined,
        rating: Number.isFinite(rating as number) ? rating : undefined,
      });
      setItems(data.items as AdminReviewRow[]);
      setTotal(data.total);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, ratingFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const maxPage = totalPages - 1;
    if (total > 0 && page > maxPage) setPage(maxPage);
  }, [total, pageSize, page]);

  const openEdit = (row: AdminReviewRow) => {
    setEditing(row);
    setFormStatus(row.status || "pending");
    setFormVerified(!!row.verified);
    setFormPinned(!!row.pinned);
    setFormTitle(row.title || "");
    setFormBody(row.body || "");
    setFormNotes((row.admin_notes as string) || "");
  };

  const closeEdit = () => {
    setEditing(null);
    setSaving(false);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await patchAdminReview(editing.id, {
        status: formStatus,
        verified: formVerified,
        pinned: formPinned,
        title: formTitle.trim(),
        body: formBody.trim(),
        admin_notes: formNotes.trim() || null,
      });
      closeEdit();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const quickStatus = async (row: AdminReviewRow, status: string) => {
    setError(null);
    try {
      await patchAdminReview(row.id, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const rating =
        ratingFilter === "" ? undefined : Number.parseInt(ratingFilter, 10);
      const blob = await downloadAdminReviewsCsv({
        status: statusFilter || undefined,
        rating: Number.isFinite(rating as number) ? rating : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reviews_export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 max-w-6xl w-full mx-auto">
      <header className="shrink-0 space-y-2 mb-3">
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.reviews.title")}</h2>
        <p className="text-sm text-[var(--text-muted)]">{t("admin.reviews.subtitle")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
            {t("admin.reviews.filterStatus")}
            <select
              value={statusFilter}
              onChange={(e) => {
                setPage(0);
                setStatusFilter(e.target.value);
              }}
              className="rounded-lg border border-[#EBEDF5] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--text)]"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.v || "all"} value={o.v}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
            {t("admin.reviews.filterRating")}
            <select
              value={ratingFilter}
              onChange={(e) => {
                setPage(0);
                setRatingFilter(e.target.value);
              }}
              className="rounded-lg border border-[#EBEDF5] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--text)]"
            >
              <option value="">{t("admin.reviews.filterAll")}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {n}★
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={exporting || loading}
            onClick={onExport}
            className="rounded-lg border border-[#EBEDF5] bg-white px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[#F5F6FA] disabled:opacity-50"
          >
            {exporting ? "…" : t("admin.reviews.exportCsv")}
          </button>
        </div>
        {error && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">
            {error}
          </p>
        )}
      </header>

      {loading && items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-12">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-6 text-center text-sm text-[var(--text-muted)]">
          {t("admin.reviews.empty")}
        </p>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
            <table className="min-w-full divide-y divide-[#EBEDF5] text-sm">
              <thead className="sticky top-0 z-20 bg-[var(--card)] shadow-[0_1px_0_#EBEDF5]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.reviews.colDate")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.reviews.colAuthor")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] whitespace-nowrap">
                    ★
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.reviews.colStatus")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[var(--text-muted)] min-w-[200px]">
                    {t("admin.reviews.colTitle")}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-[var(--text-muted)]">
                    {t("admin.reviews.colActions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EBEDF5]">
                {items.map((row) => (
                  <tr key={row.id} className="hover:bg-[#F5F6FA]/50 align-top">
                    <td className="px-3 py-2 text-xs text-[var(--text-tertiary)] whitespace-nowrap tabular-nums">
                      {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-[var(--text)]">{row.author_name}</div>
                      <div className="text-xs text-[var(--text-muted)] truncate max-w-[180px]" title={row.author_email}>
                        {row.author_email}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.rating}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.status === "approved"
                            ? "text-emerald-600 font-medium"
                            : row.status === "pending"
                              ? "text-amber-600 font-medium"
                              : "text-[var(--text-muted)]"
                        }
                      >
                        {row.status}
                      </span>
                      {row.verified ? (
                        <span className="ml-1 text-[10px] uppercase text-blue-600">✓</span>
                      ) : null}
                      {row.pinned ? (
                        <span className="ml-1 text-[10px] uppercase text-[var(--text-muted)]">📌</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[var(--text)] max-w-xs truncate" title={row.title}>
                      {row.title}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="flex flex-wrap justify-end gap-1">
                        {row.status !== "approved" ? (
                          <button
                            type="button"
                            onClick={() => quickStatus(row, "approved")}
                            className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 hover:bg-emerald-100"
                          >
                            {t("admin.reviews.approve")}
                          </button>
                        ) : null}
                        {row.status !== "rejected" ? (
                          <button
                            type="button"
                            onClick={() => quickStatus(row, "rejected")}
                            className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-800 hover:bg-red-100"
                          >
                            {t("admin.reviews.reject")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="rounded border border-[#EBEDF5] px-1.5 py-0.5 text-[10px] font-medium hover:bg-[#F5F6FA]"
                        >
                          {t("admin.reviews.edit")}
                        </button>
                      </div>
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

      {editing ? (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-edit-title"
          onClick={closeEdit}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="review-edit-title" className="text-base font-semibold text-[var(--text)]">
              {t("admin.reviews.modalTitle")}
            </h3>
            <p className="text-xs text-[var(--text-muted)] break-all">{editing.author_email}</p>
            <label className="block text-xs font-medium text-[var(--text-muted)]">
              {t("admin.reviews.colStatus")}
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-[#EBEDF5] px-2 py-1.5 text-sm"
              >
                {STATUS_OPTIONS.filter((o) => o.v).map((o) => (
                  <option key={o.v} value={o.v}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={formVerified} onChange={(e) => setFormVerified(e.target.checked)} />
                {t("admin.reviews.verified")}
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={formPinned} onChange={(e) => setFormPinned(e.target.checked)} />
                {t("admin.reviews.pinned")}
              </label>
            </div>
            <label className="block text-xs font-medium text-[var(--text-muted)]">
              {t("admin.reviews.titleField")}
              <input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-[#EBEDF5] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-muted)]">
              {t("admin.reviews.bodyField")}
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={5}
                className="mt-0.5 w-full rounded-lg border border-[#EBEDF5] px-2 py-1.5 text-sm font-sans"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-muted)]">
              {t("admin.reviews.notesField")}
              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
                className="mt-0.5 w-full rounded-lg border border-[#EBEDF5] px-2 py-1.5 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-lg border border-[#EBEDF5] px-3 py-1.5 text-sm"
              >
                {t("admin.reviews.cancel")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveEdit}
                className="rounded-lg bg-[#4578FC] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "…" : t("admin.reviews.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
