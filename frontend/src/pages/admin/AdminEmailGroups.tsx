import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ADMIN_EMAIL_SEGMENT_OPTIMIZED_UNPAID, postAdminEmailSegmentPreview } from "../../api";
import { t } from "../../i18n";

export default function AdminEmailGroups() {
  const [optimizedUnpaidCount, setOptimizedUnpaidCount] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await postAdminEmailSegmentPreview({
          segment_id: ADMIN_EMAIL_SEGMENT_OPTIMIZED_UNPAID,
          days: 30,
          sample_limit: 5,
        });
        if (!cancelled) setOptimizedUnpaidCount(p.recipients_count);
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const segments = [
    {
      id: ADMIN_EMAIL_SEGMENT_OPTIMIZED_UNPAID,
      nameKey: "admin.email.groups.demoSegment1Name",
      hintKey: "admin.email.groups.demoSegment1Hint",
      count: optimizedUnpaidCount,
    },
    {
      id: "draft-optimizers-7d",
      nameKey: "admin.email.groups.demoSegment2Name",
      hintKey: "admin.email.groups.demoSegment2Hint",
      count: null as number | null,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">{t("admin.email.groups.title")}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t("admin.email.groups.subtitle")}</p>
        <p className="mt-2 text-sm">
          <Link to="/admin/email/send" className="font-medium text-[#1D4ED8] hover:underline">
            → {t("admin.nav.emailAutomation")}
          </Link>
        </p>
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

      {loadErr && (
        <p className="text-sm text-red-700" role="alert">
          {loadErr}
        </p>
      )}

      <section aria-labelledby="admin-email-groups-list" className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm">
        <div className="border-b border-[#EBEDF5] px-4 py-3">
          <h3 id="admin-email-groups-list" className="text-sm font-semibold text-[var(--text)]">
            {t("admin.email.groups.savedSegments")}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{t("admin.email.groups.savedSegmentsHint")}</p>
        </div>
        <ul className="divide-y divide-[#EBEDF5]">
          {segments.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-[var(--text)]">{t(row.nameKey)}</p>
                <p className="text-sm text-[var(--text-muted)]">{t(row.hintKey)}</p>
                <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">{row.id}</p>
              </div>
              <div className="shrink-0 text-sm tabular-nums text-[var(--text-muted)]">
                {t("admin.email.groups.recipientsCount")}:{" "}
                {row.count === null ? "—" : row.count}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
