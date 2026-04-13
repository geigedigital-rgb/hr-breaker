import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminEmailAudience, type AdminEmailAudienceUser } from "../../api";
import AdminPaginationBar from "../../components/admin/AdminPaginationBar";
import { t } from "../../i18n";

function formatShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function AdminEmailGroups() {
  const [items, setItems] = useState<AdminEmailAudienceUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [activity, setActivity] = useState<"any" | "analyzed" | "optimized" | "login_only">("any");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tmr = window.setTimeout(() => setSearchDebounced(search.trim()), 350);
    return () => window.clearTimeout(tmr);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [searchDebounced, activity, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminEmailAudience({
        limit: pageSize,
        offset: page * pageSize,
        q: searchDebounced || undefined,
        activity,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchDebounced, activity]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (total > 0 && page > maxPage) setPage(maxPage);
  }, [total, pageSize, page]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-8 sm:px-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">{t("admin.email.groups.title")}</h2>
        <p className="text-sm text-[var(--text-muted)]">{t("admin.email.groups.subtitle")}</p>
        <p className="text-sm">
          <Link to="/admin/email/send" className="text-[#1D4ED8] hover:underline">
            {t("admin.email.groups.linkAutomation")}
          </Link>
        </p>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-black/[0.08] bg-[var(--card)] p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-[12rem] flex-1">
          <label className="text-xs font-medium text-[var(--text-tertiary)]" htmlFor="audience-search">
            {t("admin.email.groups.filterSearch")}
          </label>
          <input
            id="audience-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("admin.email.groups.searchPlaceholder")}
            className="mt-1 w-full rounded-lg border border-black/[0.1] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[#4578FC] focus:ring-1 focus:ring-[#4578FC]"
            autoComplete="off"
          />
        </div>
        <div className="min-w-[11rem]">
          <label className="text-xs font-medium text-[var(--text-tertiary)]" htmlFor="audience-activity">
            {t("admin.email.groups.filterActivity")}
          </label>
          <select
            id="audience-activity"
            value={activity}
            onChange={(e) => setActivity(e.target.value as typeof activity)}
            className="mt-1 w-full rounded-lg border border-black/[0.1] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[#4578FC] focus:ring-1 focus:ring-[#4578FC]"
          >
            <option value="any">{t("admin.email.groups.activityAny")}</option>
            <option value="analyzed">{t("admin.email.groups.activityAnalyzed")}</option>
            <option value="optimized">{t("admin.email.groups.activityOptimized")}</option>
            <option value="login_only">{t("admin.email.groups.activityLoginOnly")}</option>
          </select>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-black/[0.08] bg-[var(--card)]">
        {loading ? (
          <div className="flex justify-center py-16" aria-busy="true">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">{t("admin.email.groups.tableEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-black/[0.06] bg-black/[0.02] text-xs font-medium text-[var(--text-muted)]">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2.5">{t("admin.email.groups.colEmail")}</th>
                  <th className="whitespace-nowrap px-3 py-2.5">{t("admin.email.groups.colActivity")}</th>
                  <th className="whitespace-nowrap px-3 py-2.5">{t("admin.email.groups.colMarketing")}</th>
                  <th className="whitespace-nowrap px-3 py-2.5">{t("admin.email.groups.colWinback")}</th>
                  <th className="whitespace-nowrap px-3 py-2.5">{t("admin.email.groups.colStagger")}</th>
                  <th className="whitespace-nowrap px-3 py-2.5">{t("admin.email.groups.colJoined")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {items.map((u) => (
                  <tr key={u.id} className="hover:bg-black/[0.02]">
                    <td className="max-w-[14rem] px-3 py-2.5">
                      <Link to={`/admin/users/${u.id}`} className="break-all font-medium text-[#1D4ED8] hover:underline">
                        {u.email || "—"}
                      </Link>
                      {u.name ? <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{u.name}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="inline-flex gap-1">
                        {u.has_analyzed ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                            A
                          </span>
                        ) : null}
                        {u.has_optimized ? (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-900">O</span>
                        ) : null}
                        {!u.has_analyzed && !u.has_optimized ? (
                          <span className="text-xs text-[var(--text-tertiary)]">—</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">
                      {u.marketing_emails_opt_in === false ? t("admin.email.groups.marketingOff") : t("admin.email.groups.marketingOn")}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-[var(--text-muted)]">
                      {u.winback_sent > 0 ? (
                        <>
                          <span className="font-medium text-[var(--text)]">{u.winback_sent}</span>
                          <span className="block text-[10px] text-[var(--text-tertiary)]">{formatShort(u.winback_last_sent)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[12rem] px-3 py-2.5 text-xs text-[var(--text-muted)]">
                      {u.stagger_sent_count > 0 ? (
                        <>
                          <span className="font-medium text-[var(--text)]">{u.stagger_sent_count}</span>
                          {u.stagger_campaign_kinds ? (
                            <p className="mt-0.5 break-words font-mono text-[10px] leading-snug text-[var(--text-tertiary)]">
                              {u.stagger_campaign_kinds}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--text-muted)]">{formatShort(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AdminPaginationBar
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          disabled={loading}
        />
      </div>

      <p className="text-xs leading-relaxed text-[var(--text-tertiary)]">{t("admin.email.groups.footnote")}</p>
    </div>
  );
}
