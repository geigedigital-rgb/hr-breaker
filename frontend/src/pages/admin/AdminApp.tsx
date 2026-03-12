import { t } from "../../i18n";

export default function AdminApp() {
  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.app.title")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">{t("admin.app.subtitle")}</p>
      </header>

      <section
        className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm"
        aria-labelledby="admin-app-status"
      >
        <h3 id="admin-app-status" className="text-sm font-semibold text-[var(--text)]">
          {t("admin.app.status")}
        </h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {t("admin.app.statusOk")}. {t("admin.app.configNote")}
        </p>
      </section>
    </div>
  );
}
