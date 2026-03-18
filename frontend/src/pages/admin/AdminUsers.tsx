import { useCallback, useEffect, useState } from "react";
import { getAdminUsers, patchAdminUserPartnerAccess, type AdminUserOut } from "../../api";
import { t } from "../../i18n";

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUserOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const togglePartner = useCallback(async (u: AdminUserOut, enabled: boolean) => {
    setSavingId(u.id);
    try {
      await patchAdminUserPartnerAccess(u.id, enabled);
      setUsers((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, partner_program_access: enabled } : x))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminUsers(500)
      .then((data) => {
        if (!cancelled) setUsers(data.items);
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
      <section aria-labelledby="admin-users-error" className="rounded-xl border border-red-200 bg-red-50/80 p-4">
        <h2 id="admin-users-error" className="text-sm font-semibold text-red-800">
          {t("admin.users.loadError")}
        </h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </section>
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <header>
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.users.title")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">{t("admin.users.subtitle")}</p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-12" aria-busy="true" aria-live="polite">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
        </div>
      ) : users.length === 0 ? (
        <p className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-6 text-center text-sm text-[var(--text-muted)]">
          {t("admin.users.empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm">
          <table className="min-w-full divide-y divide-[#EBEDF5]" role="table" aria-label={t("admin.users.title")}>
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.users.email")}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.users.name")}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.users.plan")}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.users.status")}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("admin.users.createdAt")}
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                  title={t("admin.users.partnerAccessHint")}
                >
                  {t("admin.users.partnerAccess")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EBEDF5]">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-[#F5F6FA]/50">
                  <td className="px-4 py-3 text-sm font-medium text-[var(--text)]">{u.email}</td>
                  <td className="px-4 py-3 text-sm text-[var(--text-muted)]">{u.name ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-[var(--text)]">{u.subscription_plan ?? "free"}</td>
                  <td className="px-4 py-3 text-sm">
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
                  <td className="px-4 py-3 text-sm text-[var(--text-tertiary)] tabular-nums">
                    {u.created_at ? new Date(u.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
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
      )}
    </div>
  );
}
