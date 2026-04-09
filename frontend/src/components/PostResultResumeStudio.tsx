import { useState, useEffect, useRef, useCallback, type ChangeEvent, type CSSProperties } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  PhotoIcon,
  TrashIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

import * as api from "../api";
import { t, tFormat } from "../i18n";

// Use the same worker as in AdminVisualTest
const workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;
GlobalWorkerOptions.workerSrc = workerSrc;

function b64ToUint8ArraySandbox(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function pdfFirstPageToDataUrl(bytes: Uint8Array, targetCssWidth: number): Promise<string> {
  const loadingTask = getDocument({ data: bytes.slice() });
  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const cssScale = targetCssWidth / natural.width;
    const viewport = page.getViewport({ scale: cssScale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas unsupported");
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    loadingTask.destroy();
  }
}

async function cropFileToSquarePreview(file: File, maxEdge = 400): Promise<string> {
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image load failed"));
      el.src = blobUrl;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const side = Math.min(w, h);
    const sx = Math.floor((w - side) / 2);
    const sy = Math.floor((h - side) / 2);
    const canvas = document.createElement("canvas");
    const out = Math.min(side, maxEdge);
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported");
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

type ThumbState = "loading" | "error" | string;

export function PostResultResumeStudio({
  qualityPct,
  jobTitle,
  pdfFileName,
  fallbackPreviewUrl,
  schemaJson,
  initialTemplateId,
  initialPhotoDataUrl,
  onTemplateChange,
  onPhotoChange,
  onDownload,
  onTailorAnother,
  onImproveEvenStronger,
  showImproveEvenStronger,
}: {
  qualityPct: number;
  jobTitle: string;
  pdfFileName: string;
  fallbackPreviewUrl: string | null;
  schemaJson: string;
  initialTemplateId?: string;
  initialPhotoDataUrl?: string | null;
  onTemplateChange: (id: string) => void;
  onPhotoChange: (url: string | null) => void;
  onDownload: () => void;
  onTailorAnother: () => void;
  onImproveEvenStronger: () => void;
  showImproveEvenStronger: boolean;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pdfBytesRef = useRef<Map<string, Uint8Array>>(new Map());
  const mainHostRef = useRef<HTMLDivElement>(null);

  const [templates, setTemplates] = useState<api.AdminTemplateListItem[]>([]);
  const [templatesLoadError, setTemplatesLoadError] = useState(false);
  const [prefetchDone, setPrefetchDone] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, ThumbState>>({});
  const [selectedId, setSelectedId] = useState<string>(initialTemplateId || "");
  const [mainPreviewUrl, setMainPreviewUrl] = useState<string | null>(null);
  const [mainLoading, setMainLoading] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(initialPhotoDataUrl || null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const handleScroll = () => {
    const el = stripRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 5);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 5);
  };

  useEffect(() => {
    handleScroll();
  }, [templates.length, prefetchDone]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getTemplates();
        if (cancelled) return;
        setTemplates(res.items);
        if (res.items.length && !selectedId) {
          setSelectedId(res.items[0].id);
          onTemplateChange(res.items[0].id);
        }
      } catch {
        if (!cancelled) {
          setTemplatesLoadError(true);
          setTemplates([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!templates.length) {
      setPrefetchDone(true);
      return;
    }
    let cancelled = false;
    setThumbs({});
    pdfBytesRef.current = new Map();
    setPrefetchDone(false);
    
    let baseSchema: any = {};
    try {
      baseSchema = JSON.parse(schemaJson);
    } catch {
      /* ignore */
    }
    const schemaWithPhoto = {
      ...baseSchema,
      basics: {
        ...(baseSchema.basics || {}),
        image: photoDataUrl || undefined,
      },
    };

    (async () => {
      for (const tmpl of templates) {
        if (cancelled) return;
        setThumbs((s) => ({ ...s, [tmpl.id]: "loading" }));
        try {
          const res = await api.renderTemplatePdf({
            template_id: tmpl.id,
            schema: schemaWithPhoto as any,
          });
          const u8 = b64ToUint8ArraySandbox(res.pdf_base64);
          pdfBytesRef.current.set(tmpl.id, u8);
          const thumb = await pdfFirstPageToDataUrl(u8, 104);
          if (!cancelled) setThumbs((s) => ({ ...s, [tmpl.id]: thumb }));
        } catch {
          if (!cancelled) setThumbs((s) => ({ ...s, [tmpl.id]: "error" }));
        }
      }
      if (!cancelled) setPrefetchDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [templates, photoDataUrl, schemaJson]);

  const renderMainFromBytes = useCallback(async (id: string) => {
    const host = mainHostRef.current;
    const bytes = pdfBytesRef.current.get(id);
    if (!host || !bytes) return;
    setMainLoading(true);
    try {
      const w = Math.max(280, Math.min(host.clientWidth || 560, 720));
      const url = await pdfFirstPageToDataUrl(bytes, w);
      setMainPreviewUrl(url);
    } catch {
      setMainPreviewUrl(null);
    } finally {
      setMainLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId || !prefetchDone || !pdfBytesRef.current.has(selectedId)) {
      if (!templates.length) setMainPreviewUrl(null);
      return;
    }
    void renderMainFromBytes(selectedId);
  }, [selectedId, prefetchDone, templates.length, renderMainFromBytes]);

  useEffect(() => {
    const host = mainHostRef.current;
    if (!host) return;
    let deb: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (deb) clearTimeout(deb);
      deb = setTimeout(() => {
        deb = null;
        if (selectedId && pdfBytesRef.current.has(selectedId)) void renderMainFromBytes(selectedId);
      }, 140);
    });
    ro.observe(host);
    return () => {
      if (deb) clearTimeout(deb);
      ro.disconnect();
    };
  }, [selectedId, renderMainFromBytes]);

  const scrollStrip = (dir: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(240, el.clientWidth * 0.85), behavior: "smooth" });
  };

  const handlePhotoInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !f.type.startsWith("image/")) return;
    try {
      const cropped = await cropFileToSquarePreview(f);
      setPhotoDataUrl(cropped);
      onPhotoChange(cropped);
    } catch {
      /* ignore */
    }
  };

  const handleRemovePhoto = () => {
    setPhotoDataUrl(null);
    onPhotoChange(null);
  };

  const handleSelectTemplate = (id: string) => {
    setSelectedId(id);
    onTemplateChange(id);
  };

  const pct = Math.max(0, Math.min(100, Math.round(qualityPct)));
  const showFallbackPreview = templatesLoadError || !templates.length;
  const effectivePreviewUrl = showFallbackPreview ? fallbackPreviewUrl : mainPreviewUrl;

  return (
    <div className="w-full flex flex-col gap-6">
      <section className="w-full rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">{t("optimize.chooseTemplate")}</p>
        {templatesLoadError && (
          <p className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2">
            {t("optimize.templatesUnavailable")}
          </p>
        )}
        {!prefetchDone && templates.length > 0 && (
          <p className="mt-3 text-[12px] text-[#6B7280]">{t("optimize.templatesLoading")}</p>
        )}
        <div className="relative mt-4">
          {canScrollLeft && (
            <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center pl-1 pr-4 bg-gradient-to-r from-[#FAFAFC] via-[#FAFAFC] to-transparent pointer-events-none">
              <button
                type="button"
                onClick={() => scrollStrip(-1)}
                className="pointer-events-auto shrink-0 rounded-full border border-[#E8ECF4] bg-white p-2 text-[#374151] shadow-sm hover:bg-[#F8FAFD] transition-all"
                aria-label="Previous templates"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
            </div>
          )}
          <div
            ref={stripRef}
            className="flex min-h-[148px] w-full gap-3 overflow-x-auto pb-3 pt-1 px-1 [scrollbar-width:thin] scroll-smooth"
            style={{ scrollSnapType: "x proximity" }}
            onScroll={handleScroll}
          >
            {templates.map((tmpl) => {
              const th = thumbs[tmpl.id];
              const selected = selectedId === tmpl.id;
              return (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => handleSelectTemplate(tmpl.id)}
                  className="shrink-0 w-[100px] text-center transition-all scroll-ml-1 group"
                  style={{ scrollSnapAlign: "start" }}
                >
                  <p className={`mb-2 line-clamp-1 text-[10px] font-medium leading-tight transition-colors ${selected ? "text-[#4578FC]" : "text-[#181819]"}`}>
                    {tmpl.name}
                  </p>
                  <div className={`aspect-[210/297] w-full overflow-hidden rounded-lg bg-[#f1f5f9] transition-all ${
                    selected ? "ring-2 ring-[#4578FC] ring-offset-2 shadow-md" : "ring-1 ring-[#E8ECF4] group-hover:ring-[#C7D2FE] shadow-sm"
                  }`}>
                    {th === "loading" && <div className="h-full w-full animate-pulse bg-[#e2e8f0]" />}
                    {th === "error" && (
                      <div className="flex h-full items-center justify-center p-1 text-center text-[8px] text-[#64748b]">
                        {t("optimize.templatePreviewError")}
                      </div>
                    )}
                    {typeof th === "string" && th.startsWith("data:") && (
                      <img src={th} alt="" className="h-full w-full object-cover object-top" />
                    )}
                  </div>
                </button>
              );
            })}
            {templates.length === 0 && prefetchDone && (
              <div className="flex gap-3">
                {["Even", "Classic", "Flat", "Onyx"].map((label, i) => (
                  <div
                    key={label}
                    className="w-[100px] shrink-0 text-center opacity-80"
                  >
                    <p className="mb-2 text-[10px] font-medium text-[#6B7280]">{label}</p>
                    <div
                      className="aspect-[210/297] w-full rounded-lg bg-gradient-to-br from-[#f1f5f9] to-[#e2e8f0] ring-1 ring-[#E8ECF4]"
                      style={{ opacity: 1 - i * 0.1 }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          {canScrollRight && (
            <div className="absolute right-0 top-0 bottom-0 z-10 flex items-center pr-1 pl-4 bg-gradient-to-l from-[#FAFAFC] via-[#FAFAFC] to-transparent pointer-events-none">
              <button
                type="button"
                onClick={() => scrollStrip(1)}
                className="pointer-events-auto shrink-0 rounded-full border border-[#E8ECF4] bg-white p-2 text-[#374151] shadow-sm hover:bg-[#F8FAFD] transition-all"
                aria-label="Next templates"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="w-full rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">{t("optimize.addPhoto")}</p>
        <p className="mt-1 max-w-lg text-[12px] text-[#6B7280] leading-relaxed">{t("optimize.photoCropHint")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-[#E8ECF4] bg-[#f8fafc]">
            {photoDataUrl ? (
              <img src={photoDataUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[#CBD5E1]">
                <PhotoIcon className="h-7 w-7" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePhotoInput}
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="inline-flex items-center justify-center rounded-xl border-2 border-[#4578FC] bg-white px-4 py-2 text-[13px] font-semibold text-[#4578FC]"
            >
              {photoDataUrl ? t("optimize.changePhoto") : t("optimize.uploadPhoto")}
            </button>
            {photoDataUrl && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-[13px] font-medium text-[#374151]"
              >
                <TrashIcon className="h-4 w-4" />
                {t("optimize.removePhoto")}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="relative w-full overflow-hidden rounded-2xl border border-[#E8ECF4] bg-white shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#EDF1F7] bg-[#FAFAFC] px-4 py-3 sm:px-5">
          <span className="inline-flex h-9 min-w-[2.25rem] items-center justify-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 text-[13px] font-bold text-[#166534] ring-1 ring-[#BBF7D0]">
            <CheckIcon className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            <span className="tabular-nums">{pct}%</span>
          </span>
          <p className="text-[14px] font-semibold text-[#181819]">{t("optimize.readyToSubmit")}</p>
        </div>
        <div ref={mainHostRef} className="relative min-h-[200px] bg-[#F4F6FA]">
          {mainLoading && !showFallbackPreview && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
              <span className="text-[13px] text-[#6B7280]">{t("optimize.templatesLoading")}</span>
            </div>
          )}
          <div className="relative w-full">
            {effectivePreviewUrl ? (
              <img
                src={effectivePreviewUrl}
                alt=""
                className="w-full block bg-white"
              />
            ) : (
              <div className="flex min-h-[320px] items-center justify-center bg-white text-[13px] text-[#9CA3AF]">
                {!prefetchDone && templates.length > 0 ? t("optimize.templatesLoading") : t("optimize.templatePreviewError")}
              </div>
            )}
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 border-t border-white/60 bg-white/60 px-5 pt-10 pb-8 sm:px-8 sm:pt-12 sm:pb-10 shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.08)] flex flex-col items-center text-center"
            style={{ WebkitBackdropFilter: "blur(24px) saturate(1.8)", backdropFilter: "blur(24px) saturate(1.8)" } as CSSProperties}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#4578FC] mb-1.5">{t("optimize.resultExportKicker")}</p>
            <p className="text-xl font-semibold tracking-tight text-[#181819] sm:text-2xl">
              {tFormat(t("optimize.resultReadyForRole"), { jobTitle })}
            </p>
            <p className="mt-1.5 truncate text-[13px] text-[#6B7280]" title={pdfFileName}>
              {tFormat(t("optimize.resultReadySourceFile"), { file: pdfFileName })}
            </p>
            <div className="mt-6 flex w-full max-w-[280px] sm:max-w-[320px] flex-col gap-3">
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white shadow-[0_4px_20px_-8px_rgba(69,120,252,0.45)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_24px_-8px_rgba(69,120,252,0.55)]"
                style={{ background: "linear-gradient(160deg, #5e8afc 0%, #4578FC 45%, #3d6ae6 100%)" }}
              >
                <ArrowDownTrayIcon className="h-5 w-5 shrink-0" />
                {t("optimize.downloadPdf")}
              </button>
              <button
                type="button"
                onClick={onTailorAnother}
                className="inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-[#E5E7EB] bg-white/80 px-4 text-[14px] font-medium text-[#374151] hover:bg-white transition-colors"
              >
                {t("optimize.tailorAnotherVacancy")}
              </button>
              {showImproveEvenStronger && (
                <button
                  type="button"
                  onClick={onImproveEvenStronger}
                  className="inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-[#E5E7EB] bg-white/80 px-4 text-[14px] font-medium text-[#374151] hover:bg-white transition-colors"
                >
                  Improve even stronger
                </button>
              )}
            </div>
            <p className="mt-4 text-[11px] text-[#9CA3AF] leading-relaxed max-w-[280px]">
              {t("optimize.downloadPdfPaidHint")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
