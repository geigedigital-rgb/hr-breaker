import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_EMAIL_SEGMENT_OPTIMIZED_UNPAID,
  getAdminResendTemplates,
  getAdminEmailControl,
  getAdminEmailCtaInfo,
  getAdminEmailAutomations,
  getAdminUserJourney,
  patchAdminEmailControl,
  patchAdminEmailAutomation,
  postAdminEmailClearPendingQueue,
  postAdminEmailSendOne,
  postAdminEmailQueueProcess,
  postAdminEmailSegmentPreview,
  postAdminEmailSegmentSend,
  type AdminEmailAutomationItem,
  type AdminEmailAutomationsList,
  type AdminEmailControl,
  type AdminEmailCtaInfo,
  type AdminResendTemplate,
  type AdminEmailSendOneResult,
  type AdminEmailSegmentPreview,
  type AdminEmailSegmentSendResult,
  type AdminUserJourney,
} from "../../api";
import { t } from "../../i18n";

function formatCtaExpires(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function automationStatusLabel(it: AdminEmailAutomationItem): string {
  if (!it.wired && it.id === "draft_analyze_followup") return t("admin.email.send.statusPlanned");
  if (it.id === "segment_optimized_unpaid") return t("admin.email.send.statusManual");
  if (it.supports_enable_toggle) {
    if (it.paused) return t("admin.email.send.statusPaused");
    return it.enabled ? t("admin.email.send.statusRunning") : t("admin.email.send.statusStopped");
  }
  return it.wired ? "—" : t("admin.email.send.statusPlanned");
}

function automationBadgeClass(it: AdminEmailAutomationItem): string {
  if (it.id === "segment_optimized_unpaid") return "bg-slate-100 text-slate-800";
  if (!it.wired && it.id === "draft_analyze_followup") return "bg-indigo-50 text-indigo-900";
  if (it.supports_enable_toggle) {
    if (it.paused) return "bg-amber-100 text-amber-900";
    if (it.enabled) return "bg-emerald-100 text-emerald-900";
    return "bg-[#EEF0F6] text-[var(--text-muted)]";
  }
  return "bg-[#EEF0F6] text-[var(--text-muted)]";
}

export default function AdminEmailSend() {
  const [control, setControl] = useState<AdminEmailControl | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<"ok" | "err" | null>(null);

  const [auto, setAuto] = useState(false);
  const [dMin, setDMin] = useState(25);
  const [dMax, setDMax] = useState(30);
  const [tmplReminder, setTmplReminder] = useState("");
  const [tmplNudge, setTmplNudge] = useState("");

  const [days, setDays] = useState(30);
  const [limit, setLimit] = useState(15);
  const [dryRun, setDryRun] = useState(true);
  const [templateId, setTemplateId] = useState<"reminder-no-download" | "short-nudge">("reminder-no-download");

  const [preview, setPreview] = useState<AdminEmailSegmentPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<AdminEmailSegmentSendResult | null>(null);
  const [queueResult, setQueueResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resendTemplates, setResendTemplates] = useState<AdminResendTemplate[]>([]);
  const [templatesErr, setTemplatesErr] = useState<string | null>(null);
  const [singleEmail, setSingleEmail] = useState("");
  const [singleTemplateId, setSingleTemplateId] = useState("");
  const [singleResult, setSingleResult] = useState<AdminEmailSendOneResult | null>(null);
  const [ctaInfo, setCtaInfo] = useState<AdminEmailCtaInfo | null>(null);
  const [ctaLoading, setCtaLoading] = useState(false);
  const [ctaErr, setCtaErr] = useState<string | null>(null);

  const [automations, setAutomations] = useState<AdminEmailAutomationsList | null>(null);
  const [automationsErr, setAutomationsErr] = useState<string | null>(null);
  const [autoFlowBusy, setAutoFlowBusy] = useState<string | null>(null);
  const [journey, setJourney] = useState<AdminUserJourney | null>(null);
  const [journeyErr, setJourneyErr] = useState<string | null>(null);
  const [journeyBusy, setJourneyBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoadErr(null);
    setAutomationsErr(null);
    try {
      const c = await getAdminEmailControl();
      setControl(c);
      setAuto(c.winback_auto_enabled);
      setDMin(c.winback_delay_min_minutes);
      setDMax(c.winback_delay_max_minutes);
      setTmplReminder(c.resend_template_reminder_no_download ?? "");
      setTmplNudge(c.resend_template_short_nudge ?? "");
      try {
        setTemplatesErr(null);
        const ts = await getAdminResendTemplates();
        setResendTemplates(ts);
        if (ts.length > 0) {
          setSingleTemplateId((prev) => prev || ts[0].id);
        }
      } catch (e) {
        setTemplatesErr(e instanceof Error ? e.message : String(e));
        setResendTemplates([]);
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
    try {
      const am = await getAdminEmailAutomations();
      setAutomations(am);
    } catch (e) {
      setAutomations(null);
      setAutomationsErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const em = singleEmail.trim();
    if (!em.includes("@")) {
      setCtaInfo(null);
      setCtaErr(null);
      setCtaLoading(false);
      return;
    }
    let cancelled = false;
    setCtaLoading(true);
    setCtaErr(null);
    const timer = window.setTimeout(() => {
      void getAdminEmailCtaInfo(em)
        .then((d) => {
          if (!cancelled) setCtaInfo(d);
        })
        .catch((e) => {
          if (!cancelled) setCtaErr(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setCtaLoading(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [singleEmail]);

  const onSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const c = await patchAdminEmailControl({
        winback_auto_enabled: auto,
        winback_delay_min_minutes: dMin,
        winback_delay_max_minutes: dMax,
        resend_template_reminder_no_download: tmplReminder,
        resend_template_short_nudge: tmplNudge,
      });
      setControl(c);
      setSaveMsg("ok");
    } catch {
      setSaveMsg("err");
    } finally {
      setSaving(false);
    }
  };

  const onPreview = async () => {
    setBusy("preview");
    setPreviewErr(null);
    setPreview(null);
    setSendResult(null);
    try {
      const p = await postAdminEmailSegmentPreview({
        segment_id: ADMIN_EMAIL_SEGMENT_OPTIMIZED_UNPAID,
        days,
        sample_limit: 20,
      });
      setPreview(p);
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onSend = async () => {
    if (!dryRun) {
      const ok = window.confirm(
        t("admin.email.send.sendConfirm").replace("{n}", String(Math.min(limit, preview?.recipients_count ?? limit)))
      );
      if (!ok) return;
    }
    setBusy("send");
    setSendResult(null);
    try {
      const r = await postAdminEmailSegmentSend({
        segment_id: ADMIN_EMAIL_SEGMENT_OPTIMIZED_UNPAID,
        template_id: templateId,
        dry_run: dryRun,
        days,
        limit,
      });
      setSendResult(r);
      void reload();
    } catch (e) {
      setSendResult({
        segment_id: ADMIN_EMAIL_SEGMENT_OPTIMIZED_UNPAID,
        template_id: templateId,
        dry_run: dryRun,
        attempted: 0,
        sent: 0,
        failed: 0,
        errors_sample: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setBusy(null);
    }
  };

  const onSendOne = async () => {
    if (!singleEmail.trim() || !singleTemplateId.trim()) return;
    const ok = window.confirm(t("admin.email.send.singleConfirm").replace("{email}", singleEmail.trim()));
    if (!ok) return;
    setBusy("single-send");
    setSingleResult(null);
    try {
      const r = await postAdminEmailSendOne({
        email: singleEmail.trim(),
        resend_template_id: singleTemplateId.trim(),
      });
      setSingleResult(r);
    } catch (e) {
      setSingleResult({
        ok: false,
        email: singleEmail.trim(),
        resend_template_id: singleTemplateId.trim(),
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  const onProcessQueue = async () => {
    setBusy("queue");
    setQueueResult(null);
    try {
      const r = await postAdminEmailQueueProcess(25);
      setQueueResult(r);
      void reload();
    } catch (e) {
      setQueueResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const onAutomationPatch = async (id: string, body: { enabled?: boolean; paused?: boolean }) => {
    setAutoFlowBusy(id);
    setAutomationsErr(null);
    try {
      await patchAdminEmailAutomation(id, body);
      if (id === "post_optimize_winback" && body.enabled != null) setAuto(body.enabled);
      void reload();
    } catch (e) {
      setAutomationsErr(e instanceof Error ? e.message : t("admin.email.send.automationPatchErr"));
    } finally {
      setAutoFlowBusy(null);
    }
  };

  const onClearPendingQueue = async (id: string) => {
    const n = automations?.global_pending_queue_count ?? 0;
    if (!window.confirm(t("admin.email.send.clearQueueConfirm").replace("{n}", String(n)))) return;
    if (!window.confirm(t("admin.email.send.clearQueueConfirmFinal"))) return;
    setAutoFlowBusy("clear-" + id);
    setAutomationsErr(null);
    try {
      await postAdminEmailClearPendingQueue(id);
      void reload();
    } catch (e) {
      setAutomationsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoFlowBusy(null);
    }
  };

  const onLoadJourney = async () => {
    const em = singleEmail.trim();
    if (!em.includes("@")) return;
    setJourneyBusy(true);
    setJourneyErr(null);
    try {
      const j = await getAdminUserJourney(em);
      setJourney(j);
    } catch (e) {
      setJourney(null);
      setJourneyErr(e instanceof Error ? e.message : t("admin.email.send.journeyErr"));
    } finally {
      setJourneyBusy(false);
    }
  };

  if (loadErr && !control) {
    return (
      <p className="text-sm text-red-700" role="alert">
        {t("admin.email.send.loadErr")}: {loadErr}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">{t("admin.email.send.title")}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t("admin.email.send.subtitle")}</p>
      </header>

      <div
        className={`rounded-xl border p-4 text-sm ${
          control?.resend_configured
            ? "border-emerald-200 bg-emerald-50/90 text-emerald-950"
            : "border-amber-200 bg-amber-50/90 text-amber-950"
        }`}
        role="status"
      >
        {control?.resend_configured ? t("admin.email.send.resendOk") : t("admin.email.send.resendMissing")}
        {control && control.resend_configured ? (
          <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-relaxed">
            <li>
              {control.resend_template_reminder_configured
                ? t("admin.email.send.deliveryTemplateWinback")
                : t("admin.email.send.deliveryInlineWinback")}
            </li>
            <li>
              {control.resend_template_short_nudge_configured
                ? t("admin.email.send.deliveryTemplateNudge")
                : t("admin.email.send.deliveryInlineNudge")}
            </li>
          </ul>
        ) : null}
        <p className="mt-3 text-xs opacity-90">{t("admin.email.send.deliveryDocHint")}</p>
      </div>

      <section
        className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm"
        aria-labelledby="email-automations"
      >
        <h3 id="email-automations" className="text-sm font-semibold text-[var(--text)]">
          {t("admin.email.send.automationsTitle")}
        </h3>
        <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed">{t("admin.email.send.automationsSubtitle")}</p>
        {automationsErr ? (
          <p className="mt-3 text-xs text-red-700" role="alert">
            {t("admin.email.send.automationLoadErr")}: {automationsErr}
          </p>
        ) : null}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {(automations?.items ?? []).map((it) => (
            <article
              key={it.id}
              className="flex flex-col rounded-xl border border-[#E8EAEF] bg-[#FAFBFF] p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#EBEDF5] pb-3">
                <div>
                  <h4 className="text-sm font-semibold text-[var(--text)]">{it.name}</h4>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{it.id}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${automationBadgeClass(it)}`}>
                  {automationStatusLabel(it)}
                </span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">{it.description}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {t("admin.email.send.automationChannel")}: {it.channel}
                {" · "}
                {it.wired ? t("admin.email.send.automationWired") : t("admin.email.send.automationWiredNo")}
              </p>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-medium text-[var(--text)]">{t("admin.email.send.automationDedupe")}</summary>
                <p className="mt-1 leading-relaxed text-[var(--text-muted)]">{it.dedupe_summary}</p>
              </details>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer font-medium text-[var(--text)]">{t("admin.email.send.automationConditions")}</summary>
                <p className="mt-1 font-mono text-[10px] leading-relaxed text-[var(--text-muted)]">{it.conditions_code}</p>
              </details>
              {it.pending_queue_count != null ? (
                <p className="mt-2 text-xs text-[var(--text)]">
                  {t("admin.email.send.pendingLabel")}:{" "}
                  <span className="font-semibold tabular-nums">{it.pending_queue_count}</span>
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {it.supports_enable_toggle ? (
                  <>
                    <button
                      type="button"
                      disabled={autoFlowBusy != null || it.enabled}
                      onClick={() => void onAutomationPatch(it.id, { enabled: true })}
                      className="rounded-lg bg-[#1D4ED8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1e40af] disabled:opacity-40"
                    >
                      {t("admin.email.send.btnStart")}
                    </button>
                    <button
                      type="button"
                      disabled={autoFlowBusy != null || !it.enabled}
                      onClick={() => void onAutomationPatch(it.id, { enabled: false })}
                      className="rounded-lg border border-[#C9CEDD] bg-white px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[#F5F6FA] disabled:opacity-40"
                    >
                      {t("admin.email.send.btnStop")}
                    </button>
                    <button
                      type="button"
                      disabled={autoFlowBusy != null || !it.enabled || it.paused}
                      onClick={() => void onAutomationPatch(it.id, { paused: true })}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-40"
                    >
                      {t("admin.email.send.btnPause")}
                    </button>
                    <button
                      type="button"
                      disabled={autoFlowBusy != null || !it.paused}
                      onClick={() => void onAutomationPatch(it.id, { paused: false })}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-950 hover:bg-emerald-100 disabled:opacity-40"
                    >
                      {t("admin.email.send.btnResume")}
                    </button>
                  </>
                ) : it.id === "segment_optimized_unpaid" ? (
                  <p className="text-xs text-[var(--text-muted)]">{t("admin.email.send.segmentUseBelow")}</p>
                ) : null}
                {it.supports_clear_queue ? (
                  <button
                    type="button"
                    disabled={autoFlowBusy != null}
                    onClick={() => void onClearPendingQueue(it.id)}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100 disabled:opacity-40"
                  >
                    {t("admin.email.send.btnClearQueue")}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm"
        aria-labelledby="email-journey"
      >
        <h3 id="email-journey" className="text-sm font-semibold text-[var(--text)]">
          {t("admin.email.send.journeyTitle")}
        </h3>
        <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed">{t("admin.email.send.journeySubtitle")}</p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.singleEmailLabel")}</label>
            <input
              type="email"
              value={singleEmail}
              onChange={(e) => setSingleEmail(e.target.value)}
              placeholder="user@example.com"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={journeyBusy || !singleEmail.trim().includes("@")}
            onClick={() => void onLoadJourney()}
            className="rounded-lg border border-[#EBEDF5] bg-white px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[#F5F6FA] disabled:opacity-50"
          >
            {journeyBusy ? t("admin.email.send.journeyLoading") : t("admin.email.send.journeyLoad")}
          </button>
        </div>
        {journeyErr ? <p className="mt-2 text-xs text-red-700">{journeyErr}</p> : null}
        {journey ? (
          <div className="mt-4 space-y-3 rounded-lg border border-[#EBEDF5] bg-[#F9FAFB] p-4 text-sm">
            {!journey.user_found ? (
              <p className="text-amber-800">{t("admin.email.send.journeyNotFound")}</p>
            ) : (
              <>
                <p className="text-xs text-[var(--text-muted)]">
                  {t("admin.email.send.journeyUserId")}: <span className="font-mono text-[var(--text)]">{journey.user_id}</span>
                </p>
                <p className="text-xs">
                  {t("admin.email.send.journeySubscription")}:{" "}
                  <span className="font-medium">
                    {(journey.subscription_plan || "—") + " / " + (journey.subscription_status || "—")}
                  </span>
                </p>
                <p className="text-xs">
                  {t("admin.email.send.journeyMarketing")}:{" "}
                  <span className="font-medium">{String(journey.marketing_emails_opt_in)}</span>
                  {journey.admin_blocked ? (
                    <span className="ml-2 text-red-700">· {t("admin.email.send.journeyBlocked")}</span>
                  ) : null}
                </p>
                <div className="rounded-lg border border-[#EBEDF5] bg-white p-3">
                  <p className="text-xs font-semibold text-[var(--text)]">{t("admin.email.send.journeyDraft")}</p>
                  {journey.optimize_draft ? (
                    <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                      <li>
                        {t("admin.email.send.journeyStage").replace("{n}", String(journey.optimize_draft.stage ?? "—"))}
                      </li>
                      <li>
                        {t("admin.email.send.journeyExpires")}: {formatCtaExpires(journey.optimize_draft.expires_at)}
                      </li>
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">{t("admin.email.send.journeyDraftNone")}</p>
                  )}
                </div>
                <div className="rounded-lg border border-[#EBEDF5] bg-white p-3">
                  <p className="text-xs font-semibold text-[var(--text)]">{t("admin.email.send.journeySnapshot")}</p>
                  {journey.optimize_snapshot.has_valid ? (
                    <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                      <li>
                        {t("admin.email.send.journeyStage").replace("{n}", String(journey.optimize_snapshot.stage ?? "4"))}
                      </li>
                      <li>
                        {t("admin.email.send.journeyExpires")}: {formatCtaExpires(journey.optimize_snapshot.expires_at)}
                      </li>
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">{t("admin.email.send.journeySnapshotNone")}</p>
                  )}
                </div>
                <div className="rounded-lg border border-[#EBEDF5] bg-white p-3">
                  <p className="text-xs font-semibold text-[var(--text)]">{t("admin.email.send.journeyWinback")}</p>
                  {journey.winback_pending.length === 0 ? (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">{t("admin.email.send.journeyWinbackNone")}</p>
                  ) : (
                    <ul className="mt-2 max-h-32 space-y-1 overflow-auto font-mono text-[10px] text-[var(--text)]">
                      {journey.winback_pending.map((w) => (
                        <li key={w.id}>
                          {t("admin.email.send.journeyRunAt")}: {formatCtaExpires(w.run_at)} · {w.template_id}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm" aria-labelledby="email-single">
        <h3 id="email-single" className="text-sm font-semibold text-[var(--text)]">
          {t("admin.email.send.singleTitle")}
        </h3>
        <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed">{t("admin.email.send.singleHint")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.singleEmailLabel")}</label>
            <input
              type="email"
              value={singleEmail}
              onChange={(e) => setSingleEmail(e.target.value)}
              placeholder="user@example.com"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.singleTemplateLabel")}</label>
            <select
              value={singleTemplateId}
              onChange={(e) => setSingleTemplateId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 text-sm"
            >
              <option value="">{t("admin.email.send.singleTemplatePlaceholder")}</option>
              {resendTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.id})
                </option>
              ))}
            </select>
          </div>
        </div>
        {singleEmail.trim().includes("@") ? (
          <div
            className="mt-3 rounded-lg border border-[#EBEDF5] bg-[#F9FAFB] px-3 py-2.5 text-xs leading-relaxed text-[var(--text)]"
            role="status"
            aria-live="polite"
          >
            {ctaLoading ? (
              <span className="text-[var(--text-muted)]">{t("admin.email.send.singleCtaLoading")}</span>
            ) : null}
            {ctaErr ? <span className="text-red-700">{ctaErr}</span> : null}
            {!ctaLoading && !ctaErr && ctaInfo ? (
              !ctaInfo.user_found ? (
                <span className="text-amber-800">{t("admin.email.send.singleCtaUserMissing")}</span>
              ) : ctaInfo.has_valid_snapshot ? (
                <span className="text-emerald-800">
                  {t("admin.email.send.singleCtaSnapshotOk").replace(
                    "{expires}",
                    formatCtaExpires(ctaInfo.snapshot_expires_at)
                  )}
                </span>
              ) : ctaInfo.has_saved_pdf ? (
                <span className="text-amber-900">{t("admin.email.send.singleCtaPdfFallback")}</span>
              ) : (
                <span className="text-amber-900">{t("admin.email.send.singleCtaHomeOnly")}</span>
              )
            ) : null}
          </div>
        ) : null}
        {templatesErr ? <p className="mt-2 text-xs text-red-700">{templatesErr}</p> : null}
        <button
          type="button"
          disabled={busy === "single-send" || !singleEmail.trim() || !singleTemplateId.trim()}
          onClick={() => void onSendOne()}
          className="mt-4 rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white hover:bg-[#1e40af] disabled:opacity-50"
        >
          {busy === "single-send" ? "…" : t("admin.email.send.singleSend")}
        </button>
        {singleResult ? (
          <p className={`mt-2 text-xs ${singleResult.ok ? "text-emerald-700" : "text-red-700"}`}>
            {singleResult.ok
              ? t("admin.email.send.singleOk").replace("{email}", singleResult.email)
              : t("admin.email.send.singleErr").replace("{error}", singleResult.error || "unknown error")}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm" aria-labelledby="email-auto">
        <h3 id="email-auto" className="text-sm font-semibold text-[var(--text)]">
          {t("admin.email.send.autoTitle")}
        </h3>
        <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed">{t("admin.email.send.autoHint")}</p>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="rounded border-[#EBEDF5]" />
          {t("admin.email.send.autoToggle")}
        </label>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.delayMin")}</label>
            <input
              type="number"
              min={5}
              max={120}
              value={dMin}
              onChange={(e) => setDMin(Number(e.target.value) || 25)}
              className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.delayMax")}</label>
            <input
              type="number"
              min={5}
              max={180}
              value={dMax}
              onChange={(e) => setDMax(Number(e.target.value) || 30)}
              className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.resendTmplReminderLabel")}</label>
            <input
              type="text"
              value={tmplReminder}
              onChange={(e) => setTmplReminder(e.target.value)}
              placeholder="e.g. df66fcff-c452-43e3-82ee-d4fb58b7a638"
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 font-mono text-sm"
            />
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{t("admin.email.send.resendTmplReminderHint")}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.resendTmplNudgeLabel")}</label>
            <input
              type="text"
              value={tmplNudge}
              onChange={(e) => setTmplNudge(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 font-mono text-sm"
            />
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{t("admin.email.send.resendTmplNudgeHint")}</p>
          </div>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="mt-4 rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white hover:bg-[#1e40af] disabled:opacity-50"
        >
          {t("admin.email.send.save")}
        </button>
        {saveMsg === "ok" && <p className="mt-2 text-xs font-medium text-emerald-700">{t("admin.email.send.saveOk")}</p>}
        {saveMsg === "err" && <p className="mt-2 text-xs font-medium text-red-700">{t("admin.email.send.saveErr")}</p>}
      </section>

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm" aria-labelledby="email-queue">
        <h3 id="email-queue" className="text-sm font-semibold text-[var(--text)]">
          {t("admin.email.send.queueTitle")}
        </h3>
        <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed">{t("admin.email.send.queueHint")}</p>
        <p className="mt-3 text-sm text-[var(--text)]">
          {t("admin.email.send.pendingLabel")}:{" "}
          <span className="font-semibold tabular-nums">{control?.pending_queue_count ?? "—"}</span>
        </p>
        <button
          type="button"
          disabled={busy === "queue"}
          onClick={() => void onProcessQueue()}
          className="mt-3 rounded-lg border border-[#EBEDF5] bg-white px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[#F5F6FA] disabled:opacity-50"
        >
          {busy === "queue" ? "…" : t("admin.email.send.processQueue")}
        </button>
        {queueResult && (
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-[#F5F6FA] p-3 text-xs text-[var(--text)]">
            {JSON.stringify(queueResult, null, 2)}
          </pre>
        )}
      </section>

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-5 shadow-sm" aria-labelledby="email-seg">
        <h3 id="email-seg" className="text-sm font-semibold text-[var(--text)]">
          {t("admin.email.send.segmentTitle")}
        </h3>
        <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed">{t("admin.email.send.segmentHint")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.days")}</label>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 30)}
              className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.limit")}</label>
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 15)}
              className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium text-[var(--text-muted)]">{t("admin.email.send.template")}</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value as "reminder-no-download" | "short-nudge")}
            className="mt-1 w-full rounded-lg border border-[#EBEDF5] px-3 py-2 text-sm"
          >
            <option value="reminder-no-download">{t("admin.email.send.tmplWinback")}</option>
            <option value="short-nudge">{t("admin.email.send.tmplNudge")}</option>
          </select>
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="rounded border-[#EBEDF5]" />
          {t("admin.email.send.dryRun")}
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === "preview"}
            onClick={() => void onPreview()}
            className="rounded-lg border border-[#EBEDF5] bg-white px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[#F5F6FA] disabled:opacity-50"
          >
            {t("admin.email.send.preview")}
          </button>
          <button
            type="button"
            disabled={busy === "send" || !preview}
            onClick={() => void onSend()}
            className="rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white hover:bg-[#1e40af] disabled:opacity-50"
            title={!preview ? t("admin.email.send.previewFirst") : undefined}
          >
            {dryRun ? t("admin.email.send.send") + " (dry)" : t("admin.email.send.send")}
          </button>
        </div>
        {previewErr && <p className="mt-2 text-xs text-red-700">{previewErr}</p>}
        {preview && (
          <div className="mt-4 rounded-lg border border-[#EBEDF5] bg-[#F8F9FF] p-3 text-sm">
            <p className="font-medium text-[var(--text)]">
              {t("admin.email.send.recipientsCount")}:{" "}
              <span className="tabular-nums">{preview.recipients_count}</span>
            </p>
            <p className="mt-2 text-xs text-[var(--text-muted)]">{t("admin.email.send.sample")}</p>
            <ul className="mt-1 max-h-32 overflow-auto font-mono text-xs text-[var(--text)]">
              {preview.sample_emails.map((em) => (
                <li key={em}>{em}</li>
              ))}
            </ul>
          </div>
        )}
        {sendResult && (
          <div className="mt-4 text-sm text-[var(--text)]">
            <p className="font-semibold">{t("admin.email.send.sendResult")}</p>
            <p className="mt-1 text-xs">
              {t("admin.email.send.attempted")}: {sendResult.attempted} · {t("admin.email.send.sent")}: {sendResult.sent} ·{" "}
              {t("admin.email.send.failed")}: {sendResult.failed}
            </p>
            {sendResult.errors_sample?.length ? (
              <ul className="mt-2 list-disc pl-4 text-xs text-red-700">
                {sendResult.errors_sample.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
