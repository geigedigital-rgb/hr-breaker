import { useCallback, useEffect, useState } from "react";
import {
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
  type AdminEmailAutomationItem,
  type AdminEmailAutomationsList,
  type AdminEmailControl,
  type AdminEmailCtaInfo,
  type AdminResendTemplate,
  type AdminEmailSendOneResult,
  type AdminUserJourney,
} from "../../api";
import { t } from "../../i18n";

/** Shared admin surface tokens — one visual system for this page. */
const ui = {
  page: "mx-auto max-w-2xl space-y-6 pb-10",
  panel:
    "rounded-2xl border border-black/[0.07] bg-[var(--card)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6",
  title: "text-lg font-semibold tracking-tight text-[var(--text)]",
  subtitle: "mt-1 text-sm leading-relaxed text-[var(--text-muted)]",
  label: "text-xs font-medium text-[var(--text-tertiary)]",
  input:
    "mt-1.5 w-full rounded-xl border border-black/[0.08] bg-white px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20",
  btnPrimary:
    "inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-95 disabled:pointer-events-none disabled:opacity-40",
  btnSecondary:
    "inline-flex min-h-10 items-center justify-center rounded-xl border border-black/[0.1] bg-white px-4 text-sm font-medium text-[var(--text)] transition hover:bg-black/[0.03] disabled:pointer-events-none disabled:opacity-40",
  btnGhost:
    "inline-flex min-h-9 items-center justify-center rounded-lg px-3 text-xs font-medium text-[var(--text-muted)] transition hover:bg-black/[0.04] hover:text-[var(--text)] disabled:opacity-40",
  btnDanger:
    "inline-flex min-h-9 items-center justify-center rounded-lg border border-red-200/90 bg-red-50/80 px-3 text-xs font-medium text-red-900 transition hover:bg-red-100 disabled:opacity-40",
  tabBar: "flex gap-1 rounded-xl bg-black/[0.04] p-1",
  tabBtn: (active: boolean) =>
    `min-h-9 flex-1 rounded-lg px-3 text-sm font-medium transition ${
      active
        ? "bg-[var(--card)] text-[var(--text)] shadow-sm"
        : "text-[var(--text-muted)] hover:text-[var(--text)]"
    }`,
  badge: (tone: "ok" | "warn" | "neutral") =>
    tone === "ok"
      ? "border-emerald-200/80 bg-emerald-50/90 text-emerald-950"
      : tone === "warn"
        ? "border-amber-200/80 bg-amber-50/90 text-amber-950"
        : "border-black/[0.06] bg-white text-[var(--text-muted)]",
} as const;

function formatCtaExpires(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function automationStatusLabel(it: AdminEmailAutomationItem): string {
  if (it.supports_enable_toggle) {
    if (it.paused) return t("admin.email.send.statusPaused");
    return it.enabled ? t("admin.email.send.statusRunning") : t("admin.email.send.statusStopped");
  }
  return "—";
}

function automationBadgeClass(it: AdminEmailAutomationItem): string {
  if (it.supports_enable_toggle) {
    if (it.paused) return "bg-amber-100 text-amber-900";
    if (it.enabled) return "bg-emerald-100 text-emerald-900";
    return "bg-zinc-100 text-zinc-600";
  }
  return "bg-zinc-100 text-zinc-600";
}

function automationFlowLabel(id: string): string {
  if (id === "post_optimize_winback") return t("admin.email.send.automationsRowWinbackLabel");
  return id;
}

function automationWhereHint(id: string): string {
  if (id === "post_optimize_winback") return t("admin.email.send.automationsRowWinbackWhere");
  return "—";
}

export default function AdminEmailSend() {
  const [tab, setTab] = useState<"main" | "tools">("main");
  const [control, setControl] = useState<AdminEmailControl | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<"ok" | "err" | null>(null);

  const [auto, setAuto] = useState(false);
  const [dMin, setDMin] = useState(25);
  const [dMax, setDMax] = useState(30);
  const [tmplReminder, setTmplReminder] = useState("");
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

  const postWinback = automations?.items.find((i) => i.id === "post_optimize_winback");

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
        winback_auto_enabled: postWinback?.enabled ?? auto,
        winback_delay_min_minutes: dMin,
        winback_delay_max_minutes: dMax,
        resend_template_reminder_no_download: tmplReminder,
      });
      setControl(c);
      setSaveMsg("ok");
    } catch {
      setSaveMsg("err");
    } finally {
      setSaving(false);
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
    <div className={ui.page}>
      <header>
        <h2 className={ui.title}>{t("admin.email.send.title")}</h2>
        <p className={ui.subtitle}>{t("admin.email.send.subtitle")}</p>
      </header>

      <div className={ui.tabBar} role="tablist" aria-label="Email admin sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "main"}
          className={ui.tabBtn(tab === "main")}
          onClick={() => setTab("main")}
        >
          {t("admin.email.send.tabMain")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tools"}
          className={ui.tabBtn(tab === "tools")}
          onClick={() => setTab("tools")}
        >
          {t("admin.email.send.tabTools")}
        </button>
      </div>

      {tab === "main" ? (
        <div className="space-y-6">
          <div
            className={`rounded-2xl border p-4 text-sm ${ui.badge(control?.resend_configured ? "ok" : "warn")}`}
            role="status"
          >
            <p className="font-medium">{control?.resend_configured ? t("admin.email.send.resendOk") : t("admin.email.send.resendMissing")}</p>
            {control?.resend_configured ? (
              <p className="mt-2 text-xs leading-relaxed opacity-90">
                {control.resend_template_reminder_configured
                  ? t("admin.email.send.deliveryTemplateWinback")
                  : t("admin.email.send.deliveryInlineWinback")}
              </p>
            ) : null}
          </div>

          <section className={ui.panel} aria-labelledby="email-main-flows">
            <h3 id="email-main-flows" className={ui.title}>
              {t("admin.email.send.mainFlowsTitle")}
            </h3>
            <p className={`${ui.subtitle} max-w-prose`}>{t("admin.email.send.mainFlowsSubtitle")}</p>
            {automationsErr ? (
              <p className="mt-3 text-xs text-red-700" role="alert">
                {automationsErr}
              </p>
            ) : null}

            <div className="mt-5 overflow-hidden rounded-xl border border-black/[0.08] bg-[var(--card)] shadow-[0_1px_1px_rgba(0,0,0,0.03)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] bg-black/[0.02] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text)]">{t("admin.email.send.autoTitle")}</p>
                  <p className="truncate font-mono text-[10px] text-[var(--text-tertiary)]">post_optimize_winback</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${postWinback ? automationBadgeClass(postWinback) : ui.badge("neutral")}`}>
                  {postWinback ? automationStatusLabel(postWinback) : "—"}
                </span>
              </div>

              <div className="space-y-5 px-4 py-4">
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">{t("admin.email.send.autoHint")}</p>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-[1.125rem] shrink-0 rounded border-black/20 accent-[var(--accent)]"
                      checked={postWinback?.enabled ?? auto}
                      disabled={autoFlowBusy != null}
                      onChange={(e) => void onAutomationPatch("post_optimize_winback", { enabled: e.target.checked })}
                    />
                    <span className="text-sm text-[var(--text)]">{t("admin.email.send.autoToggle")}</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={autoFlowBusy != null || !(postWinback?.enabled ?? auto) || !!postWinback?.paused}
                      onClick={() => void onAutomationPatch("post_optimize_winback", { paused: true })}
                      className={ui.btnGhost}
                    >
                      {t("admin.email.send.btnPause")}
                    </button>
                    <button
                      type="button"
                      disabled={autoFlowBusy != null || !postWinback?.paused}
                      onClick={() => void onAutomationPatch("post_optimize_winback", { paused: false })}
                      className={ui.btnGhost}
                    >
                      {t("admin.email.send.btnResume")}
                    </button>
                    <button
                      type="button"
                      disabled={autoFlowBusy != null}
                      onClick={() => void onClearPendingQueue("post_optimize_winback")}
                      className={ui.btnDanger}
                    >
                      {t("admin.email.send.btnClearQueue")}
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={ui.label}>{t("admin.email.send.delayMin")}</label>
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={dMin}
                      onChange={(e) => setDMin(Number(e.target.value) || 25)}
                      className={ui.input}
                    />
                  </div>
                  <div>
                    <label className={ui.label}>{t("admin.email.send.delayMax")}</label>
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={dMax}
                      onChange={(e) => setDMax(Number(e.target.value) || 30)}
                      className={ui.input}
                    />
                  </div>
                </div>

                <div>
                  <label className={ui.label}>{t("admin.email.send.resendTmplReminderLabel")}</label>
                  <input
                    type="text"
                    value={tmplReminder}
                    onChange={(e) => setTmplReminder(e.target.value)}
                    placeholder="Resend template id"
                    autoComplete="off"
                    spellCheck={false}
                    className={`${ui.input} font-mono text-xs`}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" disabled={saving} onClick={() => void onSave()} className={ui.btnPrimary}>
                    {t("admin.email.send.save")}
                  </button>
                  <span className="text-sm text-[var(--text-muted)]">
                    {t("admin.email.send.pendingLabel")}:{" "}
                    <strong className="tabular-nums text-[var(--text)]">{control?.pending_queue_count ?? "—"}</strong>
                  </span>
                  <button
                    type="button"
                    disabled={busy === "queue"}
                    onClick={() => void onProcessQueue()}
                    className={ui.btnSecondary}
                  >
                    {busy === "queue" ? "…" : t("admin.email.send.processQueue")}
                  </button>
                </div>
                {saveMsg === "ok" && <p className="text-xs font-medium text-emerald-700">{t("admin.email.send.saveOk")}</p>}
                {saveMsg === "err" && <p className="text-xs font-medium text-red-700">{t("admin.email.send.saveErr")}</p>}
                {queueResult ? (
                  <details className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-3">
                    <summary className="cursor-pointer text-xs font-medium text-[var(--text-muted)]">
                      {t("admin.email.send.processResult")}
                    </summary>
                    <pre className="mt-2 max-h-36 overflow-auto text-[10px] leading-relaxed text-[var(--text)]">
                      {JSON.stringify(queueResult, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            </div>
          </section>

          <section className={ui.panel} aria-labelledby="email-single">
            <h3 id="email-single" className={ui.title}>
              {t("admin.email.send.singleTitle")}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("admin.email.send.singleHint")}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={ui.label}>{t("admin.email.send.singleEmailLabel")}</label>
                <input
                  type="email"
                  value={singleEmail}
                  onChange={(e) => setSingleEmail(e.target.value)}
                  placeholder="user@example.com"
                  autoComplete="off"
                  className={ui.input}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={ui.label}>{t("admin.email.send.singleTemplateLabel")}</label>
                <select value={singleTemplateId} onChange={(e) => setSingleTemplateId(e.target.value)} className={ui.input}>
                  <option value="">{t("admin.email.send.singleTemplatePlaceholder")}</option>
                  {resendTemplates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {singleEmail.trim().includes("@") ? (
              <div className={`mt-3 rounded-xl border px-3 py-2.5 text-xs ${ui.badge("neutral")}`} role="status" aria-live="polite">
                {ctaLoading ? <span className="text-[var(--text-muted)]">{t("admin.email.send.singleCtaLoading")}</span> : null}
                {ctaErr ? <span className="text-red-700">{ctaErr}</span> : null}
                {!ctaLoading && !ctaErr && ctaInfo ? (
                  !ctaInfo.user_found ? (
                    <span className="text-amber-800">{t("admin.email.send.singleCtaUserMissing")}</span>
                  ) : ctaInfo.has_valid_snapshot ? (
                    <span className="text-emerald-800">
                      {t("admin.email.send.singleCtaSnapshotOk").replace("{expires}", formatCtaExpires(ctaInfo.snapshot_expires_at))}
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
              className={`${ui.btnPrimary} mt-4`}
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

          <p className="text-center text-xs text-[var(--text-tertiary)]">{t("admin.email.send.deliveryDocHint")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          <section className={ui.panel} aria-labelledby="email-automations">
            <h3 id="email-automations" className={ui.title}>
              {t("admin.email.send.automationsTitle")}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("admin.email.send.automationsAdvancedHint")}</p>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--text-tertiary)]">{t("admin.email.send.automationsSubtitle")}</p>
            {automationsErr ? (
              <p className="mt-2 text-xs text-red-700">{t("admin.email.send.automationLoadErr")}: {automationsErr}</p>
            ) : null}
            <div className="mt-4 overflow-hidden rounded-xl border border-black/[0.06]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/[0.06] bg-black/[0.02] text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                    <th className="px-3 py-2.5">{t("admin.email.send.automationsTableFlow")}</th>
                    <th className="px-3 py-2.5">{t("admin.email.send.automationsTableState")}</th>
                    <th className="px-3 py-2.5">{t("admin.email.send.automationsTableWhere")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05]">
                  {(automations?.items ?? []).map((it) => (
                    <tr key={it.id} className="bg-[var(--card)]">
                      <td className="px-3 py-3 align-middle">
                        <span className="font-medium text-[var(--text)]">{automationFlowLabel(it.id)}</span>
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${automationBadgeClass(it)}`}>
                          {automationStatusLabel(it)}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-middle text-xs text-[var(--text-muted)]">{automationWhereHint(it.id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="mt-4 rounded-xl border border-black/[0.06] bg-black/[0.02] px-3 py-2">
              <summary className="cursor-pointer list-inside text-xs font-medium text-[var(--text-muted)] marker:text-[var(--text-tertiary)]">
                {t("admin.email.send.automationsDevNotes")}
              </summary>
              <ul className="mt-3 space-y-4 border-t border-black/[0.05] pt-3">
                {(automations?.items ?? []).map((it) => (
                  <li key={it.id} className="text-xs">
                    <p className="font-mono text-[10px] text-[var(--text-tertiary)]">{it.id}</p>
                    <p className="mt-1 text-[var(--text-muted)]">{it.description}</p>
                    <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                      <span className="font-medium text-[var(--text-muted)]">{t("admin.email.send.automationDedupe")}</span>{" "}
                      {it.dedupe_summary}
                    </p>
                    <p className="mt-1 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">{it.conditions_code}</p>
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section className={ui.panel} aria-labelledby="email-journey">
            <h3 id="email-journey" className={ui.title}>
              {t("admin.email.send.journeyTitle")}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("admin.email.send.journeySubtitle")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                type="email"
                value={singleEmail}
                onChange={(e) => setSingleEmail(e.target.value)}
                placeholder="user@example.com"
                className={`${ui.input} max-w-md flex-1`}
                aria-label={t("admin.email.send.singleEmailLabel")}
              />
              <button
                type="button"
                disabled={journeyBusy || !singleEmail.trim().includes("@")}
                onClick={() => void onLoadJourney()}
                className={ui.btnSecondary}
              >
                {journeyBusy ? t("admin.email.send.journeyLoading") : t("admin.email.send.journeyLoad")}
              </button>
            </div>
            {journeyErr ? <p className="mt-2 text-xs text-red-700">{journeyErr}</p> : null}
            {journey ? (
              <div className="mt-4 space-y-3 rounded-xl border border-black/[0.06] bg-black/[0.02] p-4 text-sm">
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
                      {t("admin.email.send.journeyMarketing")}: <span className="font-medium">{String(journey.marketing_emails_opt_in)}</span>
                      {journey.admin_blocked ? (
                        <span className="ml-2 text-red-700">· {t("admin.email.send.journeyBlocked")}</span>
                      ) : null}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border border-black/[0.06] bg-white p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                          {t("admin.email.send.journeyDraft")}
                        </p>
                        {journey.optimize_draft ? (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {t("admin.email.send.journeyStage").replace("{n}", String(journey.optimize_draft.stage ?? "—"))} ·{" "}
                            {formatCtaExpires(journey.optimize_draft.expires_at)}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t("admin.email.send.journeyDraftNone")}</p>
                        )}
                      </div>
                      <div className="rounded-lg border border-black/[0.06] bg-white p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                          {t("admin.email.send.journeySnapshot")}
                        </p>
                        {journey.optimize_snapshot.has_valid ? (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {t("admin.email.send.journeyStage").replace("{n}", String(journey.optimize_snapshot.stage ?? "4"))} ·{" "}
                            {formatCtaExpires(journey.optimize_snapshot.expires_at)}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t("admin.email.send.journeySnapshotNone")}</p>
                        )}
                      </div>
                      <div className="rounded-lg border border-black/[0.06] bg-white p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                          {t("admin.email.send.journeyWinback")}
                        </p>
                        {journey.winback_pending.length === 0 ? (
                          <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t("admin.email.send.journeyWinbackNone")}</p>
                        ) : (
                          <ul className="mt-1 max-h-24 space-y-0.5 overflow-auto font-mono text-[10px] text-[var(--text)]">
                            {journey.winback_pending.map((w) => (
                              <li key={w.id}>
                                {formatCtaExpires(w.run_at)} · {w.template_id}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </section>

          <p className="text-center text-xs text-[var(--text-tertiary)]">{t("admin.email.send.queueHint")}</p>
        </div>
      )}
    </div>
  );
}
