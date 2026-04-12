import { useCallback, useMemo, useState } from "react";
import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { ADMIN_EMAIL_DEMO_TEMPLATES, getEmailAssetOrigin, prepareEmailHtmlForAdminPreview } from "../../data/adminEmailDemoTemplates";
import { t } from "../../i18n";

export default function AdminEmailTemplates() {
  const [selectedId, setSelectedId] = useState(ADMIN_EMAIL_DEMO_TEMPLATES[0]?.id ?? "");
  const [viewport, setViewport] = useState<"mobile" | "desktop">("desktop");
  const [htmlCopy, setHtmlCopy] = useState<"idle" | "ok" | "err">("idle");
  const [urlCopy, setUrlCopy] = useState<"idle" | "ok" | "err">("idle");
  const origin = useMemo(() => getEmailAssetOrigin(), []);

  const selected = useMemo(
    () => ADMIN_EMAIL_DEMO_TEMPLATES.find((x) => x.id === selectedId) ?? ADMIN_EMAIL_DEMO_TEMPLATES[0],
    [selectedId]
  );

  const logoAssetUrl = origin ? `${origin}/logo-color.svg` : "";
  const heroAssetUrl = origin ? `${origin}/email/hero-winback.svg` : "";
  const wakeupAssetUrl = origin ? `${origin}/email/wakeup-email.svg` : "";

  const copyTemplateHtml = useCallback(async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.html);
      setHtmlCopy("ok");
      window.setTimeout(() => setHtmlCopy("idle"), 2000);
    } catch {
      setHtmlCopy("err");
      window.setTimeout(() => setHtmlCopy("idle"), 2500);
    }
  }, [selected]);

  const copyAssetUrl = useCallback(async (url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setUrlCopy("ok");
      window.setTimeout(() => setUrlCopy("idle"), 2000);
    } catch {
      setUrlCopy("err");
      window.setTimeout(() => setUrlCopy("idle"), 2500);
    }
  }, []);

  if (!selected) {
    return (
      <p className="text-sm text-[var(--text-muted)]" role="status">
        {t("admin.email.templates.empty")}
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row lg:items-start">
      <div className="w-full shrink-0 space-y-3 lg:max-w-xs">
        <header>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">{t("admin.email.templates.title")}</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{t("admin.email.templates.subtitle")}</p>
        </header>
        <ul className="space-y-1 rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-2 shadow-sm" role="listbox" aria-label={t("admin.email.templates.listLabel")}>
          {ADMIN_EMAIL_DEMO_TEMPLATES.map((tpl) => {
            const active = tpl.id === selected.id;
            return (
              <li key={tpl.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelectedId(tpl.id)}
                  className={`flex w-full flex-col rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    active ? "bg-[#EEF2FF] font-medium text-[#1a28a8]" : "text-[var(--text)] hover:bg-[#F5F6FA]"
                  }`}
                >
                  <span>{t(tpl.nameKey)}</span>
                  <span className="mt-0.5 text-xs font-normal text-[var(--text-muted)]">{t(tpl.descriptionKey)}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <section
          aria-labelledby="admin-email-asset-urls"
          className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-3 shadow-sm"
        >
          <h3 id="admin-email-asset-urls" className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {t("admin.email.templates.assetUrlsTitle")}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{t("admin.email.templates.assetUrlsHint")}</p>
          <div className="mt-3 space-y-2">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[var(--text)]">logo-color.svg</span>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-[#F5F6FA] px-2 py-1 text-[10px] text-[var(--text-muted)]">
                  {logoAssetUrl || "…"}
                </code>
                <button
                  type="button"
                  disabled={!logoAssetUrl}
                  onClick={() => void copyAssetUrl(logoAssetUrl)}
                  className="shrink-0 rounded-lg border border-[#EBEDF5] p-1.5 text-[var(--text-muted)] hover:bg-[#F5F6FA] disabled:opacity-40"
                  title={t("admin.email.templates.copyLogoUrl")}
                >
                  <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[var(--text)]">email/hero-winback.svg</span>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-[#F5F6FA] px-2 py-1 text-[10px] text-[var(--text-muted)]">
                  {heroAssetUrl || "…"}
                </code>
                <button
                  type="button"
                  disabled={!heroAssetUrl}
                  onClick={() => void copyAssetUrl(heroAssetUrl)}
                  className="shrink-0 rounded-lg border border-[#EBEDF5] p-1.5 text-[var(--text-muted)] hover:bg-[#F5F6FA] disabled:opacity-40"
                  title={t("admin.email.templates.copyHeroUrl")}
                >
                  <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[var(--text)]">email/wakeup-email.svg</span>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-[#F5F6FA] px-2 py-1 text-[10px] text-[var(--text-muted)]">
                  {wakeupAssetUrl || "…"}
                </code>
                <button
                  type="button"
                  disabled={!wakeupAssetUrl}
                  onClick={() => void copyAssetUrl(wakeupAssetUrl)}
                  className="shrink-0 rounded-lg border border-[#EBEDF5] p-1.5 text-[var(--text-muted)] hover:bg-[#F5F6FA] disabled:opacity-40"
                  title={t("admin.email.templates.copyWakeupUrl")}
                >
                  <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
          {urlCopy === "ok" && (
            <p className="mt-2 text-xs font-medium text-emerald-700" role="status">
              {t("admin.email.templates.assetUrlCopied")}
            </p>
          )}
          {urlCopy === "err" && (
            <p className="mt-2 text-xs font-medium text-red-700" role="alert">
              {t("admin.email.templates.copyError")}
            </p>
          )}
        </section>
      </div>

      <section className="min-w-0 flex-1 space-y-3" aria-labelledby="admin-email-preview-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="admin-email-preview-heading" className="text-sm font-semibold text-[var(--text)]">
            {t("admin.email.templates.previewHeading")}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyTemplateHtml()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#EBEDF5] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[#F5F6FA]"
              title={t("admin.email.templates.copyHtmlHint")}
            >
              <ClipboardDocumentIcon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
              {t("admin.email.templates.copyHtml")}
            </button>
            <div className="inline-flex rounded-lg border border-[#EBEDF5] bg-[var(--card)] p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setViewport("mobile")}
                className={`rounded-md px-3 py-1.5 transition-colors ${viewport === "mobile" ? "bg-[#EEF2FF] text-[#1a28a8]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
              >
                {t("admin.email.templates.viewportMobile")}
              </button>
              <button
                type="button"
                onClick={() => setViewport("desktop")}
                className={`rounded-md px-3 py-1.5 transition-colors ${viewport === "desktop" ? "bg-[#EEF2FF] text-[#1a28a8]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
              >
                {t("admin.email.templates.viewportDesktop")}
              </button>
            </div>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)]">{t("admin.email.templates.previewHint")}</p>
        {htmlCopy === "ok" && (
          <p className="text-xs font-medium text-emerald-700" role="status">
            {t("admin.email.templates.copyOk")}
          </p>
        )}
        {htmlCopy === "err" && (
          <p className="text-xs font-medium text-red-700" role="alert">
            {t("admin.email.templates.copyError")}
          </p>
        )}
        <div
          className={`mx-auto overflow-hidden rounded-xl border border-[#EBEDF5] bg-white shadow-sm ${
            viewport === "mobile" ? "max-w-[375px]" : "w-full max-w-[640px]"
          }`}
        >
          <iframe
            title={t("admin.email.templates.iframeTitle")}
            sandbox="allow-same-origin"
            className="h-[min(72vh,560px)] w-full border-0 bg-white"
            srcDoc={prepareEmailHtmlForAdminPreview(selected.html)}
          />
        </div>
      </section>
    </div>
  );
}
