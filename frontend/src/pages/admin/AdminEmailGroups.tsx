import { t } from "../../i18n";

/** Placeholder rows until filters + DB + Resend sync exist. */
const DEMO_SEGMENTS = [
  { id: "seg-1", nameKey: "admin.email.groups.demoSegment1Name", hintKey: "admin.email.groups.demoSegment1Hint", count: 0 },
  { id: "seg-2", nameKey: "admin.email.groups.demoSegment2Name", hintKey: "admin.email.groups.demoSegment2Hint", count: 0 },
];

export default function AdminEmailGroups() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">{t("admin.email.groups.title")}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t("admin.email.groups.subtitle")}</p>
      </header>

      <section
        aria-labelledby="admin-email-groups-resend"
        className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950"
      >
        <h3 id="admin-email-groups-resend" className="font-semibold">
          {t("admin.email.groups.resendNoteTitle")}
        </h3>
        <p className="mt-2 leading-relaxed">{t("admin.email.groups.resendNoteBody")}</p>
      </section>

      <section aria-labelledby="admin-email-groups-list" className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm">
        <div className="border-b border-[#EBEDF5] px-4 py-3">
          <h3 id="admin-email-groups-list" className="text-sm font-semibold text-[var(--text)]">
            {t("admin.email.groups.savedSegments")}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{t("admin.email.groups.savedSegmentsHint")}</p>
        </div>
        <ul className="divide-y divide-[#EBEDF5]">
          {DEMO_SEGMENTS.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-[var(--text)]">{t(row.nameKey)}</p>
                <p className="text-sm text-[var(--text-muted)]">{t(row.hintKey)}</p>
              </div>
              <div className="shrink-0 text-sm tabular-nums text-[var(--text-muted)]">
                {t("admin.email.groups.recipientsCount")}: {row.count}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
