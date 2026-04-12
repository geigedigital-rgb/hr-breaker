import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_EMAIL_SEGMENT_OPTIMIZED_UNPAID,
  getAdminEmailControl,
  patchAdminEmailControl,
  postAdminEmailQueueProcess,
  postAdminEmailSegmentPreview,
  postAdminEmailSegmentSend,
  type AdminEmailControl,
  type AdminEmailSegmentPreview,
  type AdminEmailSegmentSendResult,
} from "../../api";
import { t } from "../../i18n";

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

  const reload = useCallback(async () => {
    setLoadErr(null);
    try {
      const c = await getAdminEmailControl();
      setControl(c);
      setAuto(c.winback_auto_enabled);
      setDMin(c.winback_delay_min_minutes);
      setDMax(c.winback_delay_max_minutes);
      setTmplReminder(c.resend_template_reminder_no_download ?? "");
      setTmplNudge(c.resend_template_short_nudge ?? "");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  if (loadErr && !control) {
    return (
      <p className="text-sm text-red-700" role="alert">
        {t("admin.email.send.loadErr")}: {loadErr}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
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
