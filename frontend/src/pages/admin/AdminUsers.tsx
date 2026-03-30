import { useCallback, useEffect, useState } from "react";
import { getAdminUsers, patchAdminUserPartnerAccess, type AdminUserOut } from "../../api";
import AdminPaginationBar from "../../components/admin/AdminPaginationBar";
import { t } from "../../i18n";

const DEFAULT_PAGE_SIZE = 50;

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUserOut[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminUsers(pageSize, page * pageSize);
        if (!cancelled) {
          setUsers(data.items);
          setTotal(data.total);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, pageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const maxPage = totalPages - 1;
    if (total > 0 && page > maxPage) setPage(maxPage);
  }, [total, pageSize, page]);

  const togglePartner = useCallback(async (u: AdminUserOut, enabled: boolean) => {
    setSavingId(u.id);
    try {
      await patchAdminUserPartnerAccess(u.id, enabled);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, partner_program_access: enabled } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  }, []);

  if (error && !loading && users.length === 0 && total === 0) {
    return (
      <section aria-labelledby="admin-users-error" className="rounded-xl border border-red-200 bg-red-50/80 p-4 shrink-0">
        <h2 id="admin-users-error" className="text-sm font-semibold text-red-800">
          {t("admin.users.loadError")}
        </h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 max-w-6xl w-full mx-auto">
      <header className="shrink-0 space-y-1 mb-3">
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.users.title")}</h2>
        <p className="text-sm text-[var(--text-muted)]">{t("admin.users.subtitle")}</p>
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
      ) : users.length === 0 ? (
        <p className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-6 text-center text-sm text-[var(--text-muted)] shrink-0">
          {t("admin.users.empty")}
        </p>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
            <table className="min-w-full divide-y divide-[#EBEDF5] text-sm" role="table" aria-label={t("admin.users.title")}>
              <thead className="sticky top-0 z-20 bg-[var(--card)] shadow-[0_1px_0_#EBEDF5]">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.users.email")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.users.name")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.users.plan")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.users.status")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("admin.users.createdAt")}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap"
                    title={t("admin.users.partnerAccessHint")}
                  >
                    {t("admin.users.partnerAccess")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EBEDF5]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[#F5F6FA]/50">
                    <td className="px-4 py-3 font-medium text-[var(--text)] align-top">{u.email}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] align-top">{u.name ?? "—"}</td>
                    <td className="px-4 py-3 text-[var(--text)] align-top">{u.subscription_plan ?? "free"}</td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={
                          (u.subscription_status ?? "free") === "active" || (u.subscription_status ?? "free") === "trial"
                            ? "text-emerald-600 font-medium"
                            : "text-[var(--text-muted)]"
                        }
                      >
                        {u.subscription_status ?? "free"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)] tabular-nums whitespace-nowrap align-top">
                      {u.created_at ? new Date(u.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={!!u.partner_program_access}
                        disabled={savingId === u.id}
                        onChange={(ev) => togglePartner(u, ev.target.checked)}
                        className="h-4 w-4 rounded border-[#CBD5E1] text-[#4578FC] focus:ring-[#4578FC]"
                        aria-label={`${t("admin.users.partnerAccess")} ${u.email}`}
                      />
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
