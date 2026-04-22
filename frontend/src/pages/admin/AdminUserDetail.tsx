import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  deleteAdminUser,
  getAdminUserAccessLog,
  getAdminUserDetail,
  openAdminPdfInNewTab,
  downloadAdminResumeSource,
  patchAdminUserBlocked,
  patchAdminUserPartnerAccess,
  patchAdminUserSubscription,
  type AdminAccessLogItem,
  type AdminUserDetail,
} from "../../api";
import { adminAuditActionLabel, t, tFormat } from "../../i18n";
import { ArrowTopRightOnSquareIcon, DocumentTextIcon } from "@heroicons/react/24/outline";

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

export default function AdminUserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [journeyFileError, setJourneyFileError] = useState<string | null>(null);
  const [accessExpanded, setAccessExpanded] = useState(false);
  const [accessItems, setAccessItems] = useState<AdminAccessLogItem[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [partnerDraft, setPartnerDraft] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getAdminUserDetail(userId);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    setPartnerDraft(!!detail.partner_program_access);
  }, [detail?.id, detail?.partner_program_access]);

  useEffect(() => {
    if (!accessExpanded || !userId) return;
    let cancelled = false;
    (async () => {
      setAccessLoading(true);
      setAccessError(null);
      try {
        const res = await getAdminUserAccessLog(userId, 120);
        if (!cancelled) setAccessItems(res.items);
      } catch (e) {
        if (!cancelled) setAccessError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setAccessLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessExpanded, userId]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!userId) {
    return <p className="text-sm text-[var(--text-muted)]">{t("admin.userDetail.noUser")}</p>;
  }

  if (loading && !detail) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="max-w-2xl space-y-4">
        <Link to="/admin/users" className="text-sm text-[#4578FC] hover:underline">
          ← {t("admin.userDetail.backToList")}
        </Link>
        <section className="rounded-xl border border-red-200 bg-red-50/80 p-4">
          <h2 className="text-sm font-semibold text-red-800">{t("admin.userDetail.loadError")}</h2>
          <p className="mt-1 text-sm text-red-700">{error}</p>
        </section>
      </div>
    );
  }

  if (!detail) return null;

  const partnerDirty = partnerDraft !== !!detail.partner_program_access;

  return (
    <div className="flex flex-col min-h-0 w-full max-w-4xl mx-auto gap-4 pb-8">
      <div className="shrink-0 flex flex-wrap items-center gap-3">
        <Link to="/admin/users" className="text-sm text-[#4578FC] hover:underline font-medium">
          ← {t("admin.userDetail.backToList")}
        </Link>
        <h2 className="text-xl font-bold text-[var(--text)]">{detail.email}</h2>
        {detail.name ? <span className="text-sm text-[var(--text-muted)]">({detail.name})</span> : null}
        {detail.admin_blocked ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-red-700 bg-red-100 px-2 py-0.5 rounded-md">
            {t("admin.userDetail.blockedBadge")}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 shrink-0">
        <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            {t("admin.userDetail.whereStopped")}
          </h3>
          <p className="text-sm font-medium text-[var(--text)]">{detail.current_stage_summary}</p>
          <ul className="mt-3 space-y-1.5">
            {detail.stages.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-sm">
                <span className={s.done ? "text-emerald-600" : "text-[var(--text-tertiary)]"} aria-hidden>
                  {s.done ? "✓" : "○"}
                </span>
                <span className={s.done ? "text-[var(--text)]" : "text-[var(--text-muted)]"}>{s.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            {t("admin.userDetail.account")}
          </h3>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.auth")}</dt>
              <dd>
                {detail.has_password ? t("admin.userDetail.password") : ""}
                {detail.has_password && detail.has_google ? " · " : ""}
                {detail.has_google ? t("admin.userDetail.google") : ""}
                {!detail.has_password && !detail.has_google ? "—" : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.resumesCount")}</dt>
              <dd className="tabular-nums">{detail.resume_count}</dd>
            </div>
            {detail.readiness ? (
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--text-muted)]">{t("admin.userDetail.readiness")}</dt>
                <dd>
                  {detail.readiness.stage} ({detail.readiness.score} pts, {t("admin.userDetail.streak")}:{" "}
                  {detail.readiness.streak_days})
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      {detail.referral ? (
        <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm shrink-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            {t("admin.userDetail.referral")}
          </h3>
          <dl className="text-sm grid gap-1 sm:grid-cols-2">
            <div>
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.refCode")}</dt>
              <dd className="font-mono">{detail.referral.code}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.refReferrer")}</dt>
              <dd>{detail.referral.referrer_email ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.refSource")}</dt>
              <dd className="break-all">{detail.referral.source_url ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.refStatus")}</dt>
              <dd>{detail.referral.status}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
          {t("admin.userDetail.subscription")}
        </h3>
        <p className="text-sm mb-3">
          <span className="font-medium text-[var(--text)]">
            {detail.subscription.plan} / {detail.subscription.status}
          </span>
          {detail.subscription.current_period_end ? (
            <span className="text-[var(--text-muted)] ml-2">
              → {new Date(detail.subscription.current_period_end).toLocaleString()}
            </span>
          ) : null}
          <span className="text-[var(--text-tertiary)] ml-2">
            ({t("admin.userDetail.freeOps")}: {detail.subscription.free_analyses_count}
            {detail.subscription.free_optimize_count != null
              ? ` · ${t("admin.userDetail.freeOptimizeOps")}: ${detail.subscription.free_optimize_count}`
              : ""}
            )
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("sub-free", () =>
                patchAdminUserSubscription(userId, {
                  subscription_status: "free",
                  subscription_plan: "free",
                  current_period_end: null,
                })
              )
            }
            className="rounded-lg border border-[#EBEDF5] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#F5F6FA] disabled:opacity-50"
          >
            {t("admin.userDetail.presetFree")}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("sub-trial", () =>
                patchAdminUserSubscription(userId, {
                  subscription_status: "trial",
                  subscription_plan: "trial",
                  current_period_end: isoDaysFromNow(7),
                })
              )
            }
            className="rounded-lg border border-[#EBEDF5] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#F5F6FA] disabled:opacity-50"
          >
            {t("admin.userDetail.presetTrial7")}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("sub-monthly", () =>
                patchAdminUserSubscription(userId, {
                  subscription_status: "active",
                  subscription_plan: "monthly",
                  current_period_end: isoDaysFromNow(30),
                })
              )
            }
            className="rounded-lg border border-[#EBEDF5] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#F5F6FA] disabled:opacity-50"
          >
            {t("admin.userDetail.presetMonthly30")}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
          {t("admin.userDetail.actions")}
        </h3>
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-4">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={detail.admin_blocked}
                disabled={!!busy}
                onChange={(ev) =>
                  run("block", () => patchAdminUserBlocked(userId, ev.target.checked))
                }
                className="h-4 w-4 rounded border-[#CBD5E1] text-[#4578FC]"
              />
              <span>{t("admin.userDetail.blockAccount")}</span>
            </label>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                if (!window.confirm(tFormat(t("admin.userDetail.deleteConfirm"), { email: detail.email }))) return;
                run("del", async () => {
                  await deleteAdminUser(userId);
                  navigate("/admin/users");
                });
              }}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50 sm:ml-auto"
            >
              {t("admin.userDetail.deleteAccount")}
            </button>
          </div>
          <div className="rounded-lg border border-[#EBEDF5] bg-[#F8FAFC] p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("admin.users.partnerAccess")}
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">{t("admin.userDetail.partnerAccessHelp")}</p>
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={partnerDraft}
                  disabled={!!busy}
                  onChange={(ev) => setPartnerDraft(ev.target.checked)}
                  className="h-4 w-4 rounded border-[#CBD5E1] text-[#4578FC]"
                />
                <span>{t("admin.userDetail.partnerAccessEnable")}</span>
              </label>
              <button
                type="button"
                disabled={!!busy || !partnerDirty}
                onClick={() =>
                  run("partner-save", () => patchAdminUserPartnerAccess(userId, partnerDraft))
                }
                className="rounded-lg border border-[#4578FC] bg-[#4578FC] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3d6ae8] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#4578FC]"
              >
                {t("admin.userDetail.savePartnerAccess")}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] px-4 pt-4">
          {t("admin.userDetail.journeyLog")}
        </h3>
        <p className="px-4 pb-1 text-[11px] text-[var(--text-tertiary)] leading-snug">
          {t("admin.userDetail.journeyLogHint")}
        </p>
        {journeyFileError ? (
          <p className="px-4 pb-2 text-xs text-amber-800 bg-amber-50 border-y border-amber-100" role="status">
            {journeyFileError}
          </p>
        ) : null}
        <div className="p-4 pt-2">
          <ul className="space-y-3 text-sm border-l-2 border-[#EBEDF5] ml-2 pl-4">
            {detail.journey.map((j, i) => {
              const auditMetaParts: string[] = [];
              if (j.kind === "audit") {
                const m = j.model?.trim();
                if (m) auditMetaParts.push(m);
                const tin = j.input_tokens ?? 0;
                const tout = j.output_tokens ?? 0;
                if (tin > 0 || tout > 0) auditMetaParts.push(`${tin}→${tout} tok`);
                const code = (j.action || j.title || "").trim();
                if (code && adminAuditActionLabel(code) !== code) auditMetaParts.push(code);
              }
              const auditMetaLine = auditMetaParts.length > 0 ? auditMetaParts.join(" · ") : null;
              const entryTitle =
                j.kind === "audit"
                  ? adminAuditActionLabel((j.action || j.title || "").trim() || null)
                  : j.title;
              return (
                <li key={`${j.kind}-${j.at}-${i}`} className="relative">
                  <span className="absolute -left-[1.15rem] top-1.5 h-2 w-2 rounded-full bg-[#4578FC]" aria-hidden />
                  <p className="text-xs text-[var(--text-tertiary)] tabular-nums">
                    {j.at ? new Date(j.at).toLocaleString() : "—"}
                  </p>
                  <p className="font-medium text-[var(--text)]">
                    {entryTitle}
                    {j.kind === "audit" && j.success === false ? (
                      <span className="ml-2 text-xs text-red-600">{t("admin.userDetail.failed")}</span>
                    ) : null}
                  </p>
                  {auditMetaLine ? (
                    <p className="text-[11px] text-[var(--text-tertiary)] font-mono mt-0.5 tabular-nums break-all">{auditMetaLine}</p>
                  ) : null}
                  {j.detail ? (
                    <p className="text-[var(--text-muted)] text-xs mt-0.5 break-words whitespace-pre-wrap">{j.detail}</p>
                  ) : null}
                  {j.kind === "resume" && j.pdf_filename ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setJourneyFileError(null);
                          void openAdminPdfInNewTab(j.pdf_filename!).catch((e) =>
                            setJourneyFileError(e instanceof Error ? e.message : t("admin.activity.openError")),
                          );
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#E8ECF4] bg-white px-2.5 py-1.5 text-xs font-medium text-[#4578FC] hover:bg-[#F5F8FF]"
                      >
                        <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0" aria-hidden />
                        {t("admin.activity.openPdf")}
                      </button>
                      {j.has_stored_source ? (
                        <button
                          type="button"
                          onClick={() => {
                            setJourneyFileError(null);
                            void downloadAdminResumeSource(j.pdf_filename!).catch((e) =>
                              setJourneyFileError(e instanceof Error ? e.message : t("admin.activity.openError")),
                            );
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#E8ECF4] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[#F5F6FA]"
                        >
                          <DocumentTextIcon className="h-4 w-4 shrink-0" aria-hidden />
                          {t("admin.activity.downloadSource")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm shrink-0">
        <div className="px-4 pt-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("admin.userDetail.accessLogTitle")}
            </h3>
            <p className="text-[11px] text-[var(--text-tertiary)] leading-snug mt-1 max-w-xl">
              {t("admin.userDetail.accessLogHint")}
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={accessExpanded}
              onChange={(e) => {
                setAccessExpanded(e.target.checked);
                if (!e.target.checked) {
                  setAccessItems([]);
                  setAccessError(null);
                }
              }}
              className="h-4 w-4 rounded border-[#CBD5E1] text-[#4578FC] focus:ring-[#4578FC]"
            />
            <span>{t("admin.userDetail.accessLogToggle")}</span>
          </label>
        </div>
        {accessExpanded ? (
          <div className="p-4 pt-2">
            {accessError ? (
              <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">
                {accessError}
              </p>
            ) : accessLoading ? (
              <div className="flex justify-center py-8" aria-busy="true">
                <span className="h-7 w-7 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" />
              </div>
            ) : accessItems.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">{t("admin.userDetail.accessLogEmpty")}</p>
            ) : (
              <div className="overflow-x-auto border border-[#EBEDF5] rounded-lg">
                <table className="min-w-full text-xs">
                  <thead className="bg-[#F5F6FA] text-[var(--text-muted)]">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("admin.userDetail.accessColTime")}</th>
                      <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("admin.userDetail.accessColEvent")}</th>
                      <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("admin.userDetail.accessColIp")}</th>
                      <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("admin.userDetail.accessColCountry")}</th>
                      <th className="text-left font-semibold px-3 py-2">{t("admin.userDetail.accessColDevice")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EBEDF5]">
                    {accessItems.map((row, idx) => (
                      <tr key={`${row.created_at}-${idx}`} className="align-top">
                        <td className="px-3 py-2 tabular-nums text-[var(--text-tertiary)] whitespace-nowrap">
                          {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                        </td>
                        <td className="px-3 py-2 text-[var(--text)]">
                          {row.event_type === "register"
                            ? t("admin.userDetail.accessEventRegister")
                            : row.event_type === "login"
                              ? t("admin.userDetail.accessEventLogin")
                              : row.event_type}
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--text-muted)] break-all max-w-[10rem]">{row.ip ?? "—"}</td>
                        <td className="px-3 py-2 text-[var(--text-muted)] whitespace-nowrap">
                          {[row.country, row.country_code].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-tertiary)] break-words max-w-[16rem]" title={row.device ?? ""}>
                          {row.device ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
