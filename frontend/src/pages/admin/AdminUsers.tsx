import { useEffect, useState } from "react";
import { getAdminUsers, type AdminUserOut } from "../../api";
import { t } from "../../i18n";

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUserOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
                  {t("admin.users.createdAt")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EBEDF5]">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-[#F5F6FA]/50">
                  <td className="px-4 py-3 text-sm font-medium text-[var(--text)]">{u.email}</td>
                  <td className="px-4 py-3 text-sm text-[var(--text-muted)]">{u.name ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-[var(--text-tertiary)] tabular-nums">
                    {u.created_at ? new Date(u.created_at).toLocaleString() : "—"}
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
