import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bars3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  adminExtractResumeSchema,
  adminExtractResumeSchemaFromFile,
  adminRenderTemplatePdf,
  getAdminTemplates,
  type AdminTemplateListItem,
  type UnifiedResumeSchema,
} from "../../api";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorker;

const EMPTY_SCHEMA: UnifiedResumeSchema = {
  schema_version: "1.0",
  meta: { layout_hints: {} },
  basics: { name: "" },
  work: [],
  education: [],
  skills: [],
  projects: [],
  certificates: [],
  languages: [],
  awards: [],
  publications: [],
};

const STEPS = ["Contacts", "Experience", "Education", "Skills", "Summary", "Finalize"] as const;
type Step = (typeof STEPS)[number];

const STEP_HINT: Record<Step, string> = {
  Contacts: "Name, contacts, and optional AI import from text or file.",
  Experience: "List roles starting with the most recent. Add bullets per role.",
  Education: "Degrees and schools. Add as many entries as you need.",
  Skills: "Skill groups and keywords. Add or remove groups freely.",
  Summary: "Short professional summary shown on the resume.",
  Finalize: "Languages and PDF export. Template is chosen above the preview.",
};

function b64ToBlob(base64: string, mime = "application/pdf"): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function b64ToUint8Array(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function moveItem<T>(arr: T[], index: number, delta: number): T[] {
  const j = index + delta;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

function cleanText(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t ? t : null;
}

function normalizeSchemaForRender(schema: UnifiedResumeSchema): UnifiedResumeSchema {
  return {
    ...schema,
    basics: {
      ...schema.basics,
      name: (schema.basics.name || "").trim() || "Candidate",
      label: cleanText(schema.basics.label),
      email: cleanText(schema.basics.email),
      phone: cleanText(schema.basics.phone),
      url: cleanText(schema.basics.url),
      summary: cleanText(schema.basics.summary),
    },
    work: schema.work
      .map((w) => ({
        ...w,
        name: (w.name || "").trim(),
        position: (w.position || "").trim(),
        start_date: cleanText(w.start_date),
        end_date: cleanText(w.end_date),
        highlights: (w.highlights || []).map((h) => h.trim()).filter(Boolean),
      }))
      .filter((w) => Boolean(w.name || w.position || w.start_date || w.end_date || w.highlights.length)),
    education: schema.education
      .map((e) => ({
        ...e,
        institution: (e.institution || "").trim(),
        area: cleanText(e.area),
        study_type: cleanText(e.study_type),
        start_date: cleanText(e.start_date),
        end_date: cleanText(e.end_date),
      }))
      .filter((e) => Boolean(e.institution || e.area || e.study_type || e.start_date || e.end_date)),
    skills: schema.skills
      .map((s) => ({
        ...s,
        name: (s.name || "").trim(),
        level: cleanText(s.level),
        keywords: (s.keywords || []).map((k) => k.trim()).filter(Boolean),
      }))
      .filter((s) => Boolean(s.name || s.keywords.length)),
    projects: schema.projects
      .map((p) => ({
        ...p,
        name: (p.name || "").trim(),
        description: cleanText(p.description),
        highlights: (p.highlights || []).map((h) => h.trim()).filter(Boolean),
      }))
      .filter((p) => Boolean(p.name || p.description || p.highlights.length)),
    certificates: schema.certificates
      .map((c) => ({
        ...c,
        name: (c.name || "").trim(),
        issuer: cleanText(c.issuer),
        date: cleanText(c.date),
      }))
      .filter((c) => Boolean(c.name || c.issuer || c.date)),
    languages: schema.languages
      .map((l) => ({
        ...l,
        language: (l.language || "").trim(),
        fluency: cleanText(l.fluency),
      }))
      .filter((l) => Boolean(l.language)),
    awards: schema.awards
      .map((a) => ({
        ...a,
        title: (a.title || "").trim(),
        summary: cleanText(a.summary),
      }))
      .filter((a) => Boolean(a.title || a.summary)),
    publications: schema.publications
      .map((p) => ({
        ...p,
        name: (p.name || "").trim(),
        publisher: cleanText(p.publisher),
        summary: cleanText(p.summary),
      }))
      .filter((p) => Boolean(p.name || p.publisher || p.summary)),
  };
}

export default function AdminTemplatesLab() {
  const resumeScore = 100; // temporary placeholder
  const [step, setStep] = useState<Step>("Contacts");
  const [resumeSource, setResumeSource] = useState("");
  const [templates, setTemplates] = useState<AdminTemplateListItem[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [schema, setSchema] = useState<UnifiedResumeSchema>(EMPTY_SCHEMA);
  const [previewPdfBytes, setPreviewPdfBytes] = useState<Uint8Array | null>(null);
  const [previewPages, setPreviewPages] = useState<Array<{ page: number; src: string }>>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [openWork, setOpenWork] = useState<Record<number, boolean>>({});
  const [openEdu, setOpenEdu] = useState<Record<number, boolean>>({});
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [commitPreviewTick, setCommitPreviewTick] = useState(0);
  const previewReqIdRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderSchemaRef = useRef<UnifiedResumeSchema>(EMPTY_SCHEMA);
  const templateIdRef = useRef("");
  const previewCanvasHostRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const renderSchema = useMemo(() => normalizeSchemaForRender(schema), [schema]);

  renderSchemaRef.current = renderSchema;
  templateIdRef.current = templateId;

  const isEditableField = useCallback((el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }, []);

  const commitPreviewRefresh = useCallback(() => {
    // Next tick: ensure the latest onChange value is already in React state.
    window.setTimeout(() => {
      setCommitPreviewTick((v) => v + 1);
    }, 0);
  }, []);

  useEffect(() => {
    getAdminTemplates()
      .then((res) => {
        const sorted = [...res.items].sort((a, b) => b.pdf_stability_score - a.pdf_stability_score);
        setTemplates(sorted);
        if (sorted.length > 0) setTemplateId((prev) => prev || sorted[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  /** Single queue: cancels prior timer and in-flight fetch. Refs = no stale schema/template. */
  const schedulePreview = useCallback((delayMs: number) => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      const tid = templateIdRef.current;
      if (!tid) return;

      previewAbortRef.current?.abort();
      const ac = new AbortController();
      previewAbortRef.current = ac;

      const reqId = ++previewReqIdRef.current;
      setLoadingPreview(true);
      setError(null);
      adminRenderTemplatePdf({
        template_id: tid,
        schema: renderSchemaRef.current,
        signal: ac.signal,
      })
        .then((res) => {
          if (reqId !== previewReqIdRef.current) return;
          setPdfPageCount(res.page_count);
          setPdfWarnings(res.warnings);
          setPreviewPdfBytes(b64ToUint8Array(res.pdf_base64));
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          if (e instanceof Error && e.name === "AbortError") return;
          if (reqId === previewReqIdRef.current) setError(String(e));
        })
        .finally(() => {
          if (reqId === previewReqIdRef.current) setLoadingPreview(false);
        });
    }, delayMs);
  }, []);

  useEffect(
    () => () => {
      if (previewTimerRef.current !== null) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      previewAbortRef.current?.abort();
    },
    []
  );

  // Typing / structured edits: debounced server render; abort stale in-flight PDF when schema moves again.
  useEffect(() => {
    schedulePreview(380);
    return () => {
      if (previewTimerRef.current !== null) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      previewAbortRef.current?.abort();
    };
  }, [renderSchema, schedulePreview]);

  // Template menu or blur/enter commit: flush immediately and cancel pending debounce.
  useEffect(() => {
    if (!templateId) return;
    schedulePreview(0);
  }, [templateId, commitPreviewTick, schedulePreview]);

  useEffect(() => {
    if (!templateMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!templateMenuRef.current) return;
      const node = e.target as Node;
      if (!templateMenuRef.current.contains(node)) {
        setTemplateMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [templateMenuOpen]);

  useEffect(() => {
    if (!previewPdfBytes) return;
    let cancelled = false;
    const host = previewCanvasHostRef.current;
    if (!host) return;
    let renderSeq = 0;
    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;

    const renderPages = async () => {
      const seq = ++renderSeq;
      const loadingTask = getDocument({ data: previewPdfBytes });
      try {
        const pdf = await loadingTask.promise;
        const hostWidth = Math.max(1, host.clientWidth);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const nextPages: Array<{ page: number; src: string }> = [];

        for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
          if (cancelled || seq !== renderSeq) return;
          const page = await pdf.getPage(pageNo);
          if (cancelled || seq !== renderSeq) return;
          const natural = page.getViewport({ scale: 1 });
          // Fit page width to preview column; keep true page layout ratio.
          const cssScale = hostWidth / natural.width;
          const viewport = page.getViewport({ scale: cssScale });
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) continue;
          canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
          canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, viewport.width, viewport.height);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          nextPages.push({ page: pageNo, src: canvas.toDataURL("image/png") });
        }
        if (!cancelled && seq === renderSeq) {
          setPreviewPages(nextPages);
        }
      } catch {
        // Keep previous frame on render failure.
      } finally {
        loadingTask.destroy();
      }
    };

    renderPages();
    const ro = new ResizeObserver(() => {
      if (resizeDebounce !== null) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => {
        resizeDebounce = null;
        if (!cancelled) renderPages();
      }, 120);
    });
    ro.observe(host);
    return () => {
      cancelled = true;
      if (resizeDebounce !== null) clearTimeout(resizeDebounce);
      ro.disconnect();
    };
  }, [previewPdfBytes]);

  const stepIndex = STEPS.indexOf(step);
  const nextStep = STEPS[stepIndex + 1];
  const prevStep = STEPS[stepIndex - 1];

  const inputClass =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#2f40df] focus:outline-none focus:ring-1 focus:ring-[#2f40df]";

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--text)]">Templates Lab</h2>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* 60/40: form vs preview */}
      <div className="grid min-h-[calc(100vh-10rem)] min-w-0 grid-cols-1 gap-6 overflow-x-hidden xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-start xl:gap-8">
        {/* —— Data wizard (single card) —— */}
        <div
          className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm"
          onBlurCapture={(e) => {
            if (isEditableField(e.target)) commitPreviewRefresh();
          }}
          onKeyDownCapture={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            if (isEditableField(e.target)) commitPreviewRefresh();
          }}
        >
          {/* Stepper */}
          <div className="relative mb-6 border-b border-slate-100 pb-4">
            <div className="flex flex-wrap gap-1">
              {STEPS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStep(s)}
                  className={`relative rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    step === s
                      ? "bg-[#2f40df] text-white"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                  }`}
                >
                  <span className="hidden sm:inline">{s}</span>
                  <span className="sm:hidden">{i + 1}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{step}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{STEP_HINT[step]}</p>
            </div>
          </div>

          {/* Contacts */}
          {step === "Contacts" && (
            <div className="space-y-4">
              <details className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium text-slate-700">Import with AI (text or file)</summary>
                <p className="mt-2 text-xs text-slate-500">
                  Paste resume text or upload PDF/DOCX/TXT. Two-pass extraction tightens facts to your source.
                </p>
                <textarea
                  value={resumeSource}
                  onChange={(e) => setResumeSource(e.target.value)}
                  placeholder="Paste resume text…"
                  rows={4}
                  className={`${inputClass} mt-2`}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      setError(null);
                      setExtracting(true);
                      try {
                        const out = await adminExtractResumeSchema({ resume_content: resumeSource });
                        setSchema(out);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setExtracting(false);
                      }
                    }}
                    disabled={!resumeSource.trim() || extracting}
                    className="rounded-lg bg-[#2f40df] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {extracting ? "Parsing…" : "Parse text"}
                  </button>
                  <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt,.md,.tex,.html,.htm"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setResumeFile(f);
                        e.target.value = "";
                      }}
                    />
                    File
                  </label>
                  {resumeFile && (
                    <span className="max-w-[10rem] truncate text-xs text-slate-500" title={resumeFile.name}>
                      {resumeFile.name}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!resumeFile) return;
                      setError(null);
                      setExtracting(true);
                      try {
                        const out = await adminExtractResumeSchemaFromFile({ file: resumeFile });
                        setSchema(out);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setExtracting(false);
                      }
                    }}
                    disabled={!resumeFile || extracting}
                    className="rounded-lg bg-[#2f40df] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Parse file
                  </button>
                </div>
              </details>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  value={schema.basics.name}
                  onChange={(e) => setSchema((s) => ({ ...s, basics: { ...s.basics, name: e.target.value } }))}
                  placeholder="Full name"
                  className={inputClass}
                />
                <input
                  value={schema.basics.label ?? ""}
                  onChange={(e) => setSchema((s) => ({ ...s, basics: { ...s.basics, label: e.target.value } }))}
                  placeholder="Headline / title"
                  className={inputClass}
                />
                <input
                  value={schema.basics.email ?? ""}
                  onChange={(e) => setSchema((s) => ({ ...s, basics: { ...s.basics, email: e.target.value } }))}
                  placeholder="Email"
                  className={inputClass}
                />
                <input
                  value={schema.basics.phone ?? ""}
                  onChange={(e) => setSchema((s) => ({ ...s, basics: { ...s.basics, phone: e.target.value } }))}
                  placeholder="Phone"
                  className={inputClass}
                />
                <input
                  value={schema.basics.url ?? ""}
                  onChange={(e) => setSchema((s) => ({ ...s, basics: { ...s.basics, url: e.target.value } }))}
                  placeholder="Website / LinkedIn"
                  className={`${inputClass} sm:col-span-2`}
                />
              </div>
            </div>
          )}

          {/* Experience */}
          {step === "Experience" && (
            <div className="space-y-3">
              {schema.work.length === 0 && (
                <p className="text-sm text-slate-500">No roles yet. Add your first position below.</p>
              )}
              {schema.work.map((w, i) => {
                const expanded = openWork[i] ?? true;
                const titleBit = [w.position, w.name].filter(Boolean).join(", ") || "New role";
                const dateBit = [w.start_date, w.end_date].filter(Boolean).join(" – ");
                const summaryLine = dateBit ? `${titleBit} | ${dateBit}` : titleBit;
                return (
                  <div
                    key={i}
                    className="rounded-xl border border-slate-200 bg-slate-50/30 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col gap-0.5 pt-1 text-slate-400">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() => {
                            setSchema((s) => ({ ...s, work: moveItem(s.work, i, -1) }));
                            setOpenWork((o) => {
                              const n = { ...o };
                              const t = n[i];
                              n[i] = n[i - 1];
                              n[i - 1] = t;
                              return n;
                            });
                          }}
                          className="rounded p-0.5 hover:bg-slate-200 disabled:opacity-30"
                        >
                          <ChevronUpIcon className="h-4 w-4" />
                        </button>
                        <Bars3Icon className="h-4 w-4 opacity-50" aria-hidden />
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={i === schema.work.length - 1}
                          onClick={() => {
                            setSchema((s) => ({ ...s, work: moveItem(s.work, i, 1) }));
                            setOpenWork((o) => {
                              const n = { ...o };
                              const t = n[i];
                              n[i] = n[i + 1];
                              n[i + 1] = t;
                              return n;
                            });
                          }}
                          className="rounded p-0.5 hover:bg-slate-200 disabled:opacity-30"
                        >
                          <ChevronDownIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setOpenWork((o) => ({ ...o, [i]: !expanded }))}
                          className="flex w-full items-center justify-between gap-2 text-left"
                        >
                          <span className="truncate text-sm font-medium text-slate-800">{summaryLine}</span>
                          <ChevronDownIcon className={`h-5 w-5 shrink-0 text-slate-400 transition ${expanded ? "rotate-180" : ""}`} />
                        </button>
                        {expanded && (
                          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input
                              value={w.position}
                              onChange={(e) =>
                                setSchema((s) => ({
                                  ...s,
                                  work: s.work.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)),
                                }))
                              }
                              placeholder="Job title"
                              className={inputClass}
                            />
                            <input
                              value={w.name}
                              onChange={(e) =>
                                setSchema((s) => ({
                                  ...s,
                                  work: s.work.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                                }))
                              }
                              placeholder="Company"
                              className={inputClass}
                            />
                            <input
                              value={w.start_date ?? ""}
                              onChange={(e) =>
                                setSchema((s) => ({
                                  ...s,
                                  work: s.work.map((x, j) => (j === i ? { ...x, start_date: e.target.value || null } : x)),
                                }))
                              }
                              placeholder="Start (e.g. Jan 2020)"
                              className={inputClass}
                            />
                            <input
                              value={w.end_date ?? ""}
                              onChange={(e) =>
                                setSchema((s) => ({
                                  ...s,
                                  work: s.work.map((x, j) => (j === i ? { ...x, end_date: e.target.value || null } : x)),
                                }))
                              }
                              placeholder="End (or Present)"
                              className={inputClass}
                            />
                            <div className="sm:col-span-2">
                              <label className="mb-1 block text-xs font-medium text-slate-500">Highlights (one per line)</label>
                              <textarea
                                value={w.highlights.join("\n")}
                                onChange={(e) =>
                                  setSchema((s) => ({
                                    ...s,
                                    work: s.work.map((x, j) =>
                                      j === i
                                        ? {
                                            ...x,
                                            // Keep user line breaks while typing; cleanup happens in normalizeSchemaForRender().
                                            highlights: e.target.value.split("\n"),
                                          }
                                        : x
                                    ),
                                  }))
                                }
                                rows={4}
                                placeholder="Achievement or responsibility…"
                                className={inputClass}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label="Remove role"
                        onClick={() =>
                          setSchema((s) => ({
                            ...s,
                            work: s.work.filter((_, j) => j !== i),
                          }))
                        }
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setSchema((s) => ({
                    ...s,
                    work: [...s.work, { name: "", position: "", highlights: [] }],
                  }))
                }
                className="flex items-center gap-1.5 text-sm font-medium text-[#2f40df] hover:underline"
              >
                <PlusIcon className="h-5 w-5" />
                Add work experience
              </button>
            </div>
          )}

          {/* Education */}
          {step === "Education" && (
            <div className="space-y-3">
              {schema.education.length === 0 && (
                <p className="text-sm text-slate-500">No education entries yet.</p>
              )}
              {schema.education.map((ed, i) => {
                const expanded = openEdu[i] ?? true;
                const line = [ed.study_type, ed.institution].filter(Boolean).join(" — ") || "New entry";
                return (
                  <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/30 p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col gap-0.5 pt-1 text-slate-400">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() => {
                            setSchema((s) => ({ ...s, education: moveItem(s.education, i, -1) }));
                            setOpenEdu((o) => {
                              const n = { ...o };
                              const t = n[i];
                              n[i] = n[i - 1];
                              n[i - 1] = t;
                              return n;
                            });
                          }}
                          className="rounded p-0.5 hover:bg-slate-200 disabled:opacity-30"
                        >
                          <ChevronUpIcon className="h-4 w-4" />
                        </button>
                        <Bars3Icon className="h-4 w-4 opacity-50" aria-hidden />
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={i === schema.education.length - 1}
                          onClick={() => {
                            setSchema((s) => ({ ...s, education: moveItem(s.education, i, 1) }));
                            setOpenEdu((o) => {
                              const n = { ...o };
                              const t = n[i];
                              n[i] = n[i + 1];
                              n[i + 1] = t;
                              return n;
                            });
                          }}
                          className="rounded p-0.5 hover:bg-slate-200 disabled:opacity-30"
                        >
                          <ChevronDownIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setOpenEdu((o) => ({ ...o, [i]: !expanded }))}
                          className="flex w-full items-center justify-between gap-2 text-left"
                        >
                          <span className="truncate text-sm font-medium text-slate-800">{line}</span>
                          <ChevronDownIcon className={`h-5 w-5 shrink-0 text-slate-400 transition ${expanded ? "rotate-180" : ""}`} />
                        </button>
                        {expanded && (
                          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input
                              value={ed.institution}
                              onChange={(e) =>
                                setSchema((s) => ({
                                  ...s,
                                  education: s.education.map((x, j) =>
                                    j === i ? { ...x, institution: e.target.value } : x
                                  ),
                                }))
                              }
                              placeholder="School / university"
                              className={`${inputClass} sm:col-span-2`}
                            />
                            <input
                              value={ed.study_type ?? ""}
                              onChange={(e) =>
                                setSchema((s) => ({
                                  ...s,
                                  education: s.education.map((x, j) =>
                                    j === i ? { ...x, study_type: e.target.value || null } : x
                                  ),
                                }))
                              }
                              placeholder="Degree / program"
                              className={inputClass}
                            />
                            <input
                              value={ed.area ?? ""}
                              onChange={(e) =>
                                setSchema((s) => ({
                                  ...s,
                                  education: s.education.map((x, j) =>
                                    j === i ? { ...x, area: e.target.value || null } : x
                                  ),
                                }))
                              }
                              placeholder="Field of study"
                              className={inputClass}
                            />
                            <input
                              value={ed.start_date ?? ""}
                              onChange={(e) =>
                                setSchema((s) => ({
                                  ...s,
                                  education: s.education.map((x, j) =>
                                    j === i ? { ...x, start_date: e.target.value || null } : x
                                  ),
                                }))
                              }
                              placeholder="Start"
                              className={inputClass}
                            />
                            <input
                              value={ed.end_date ?? ""}
                              onChange={(e) =>
                                setSchema((s) => ({
                                  ...s,
                                  education: s.education.map((x, j) =>
                                    j === i ? { ...x, end_date: e.target.value || null } : x
                                  ),
                                }))
                              }
                              placeholder="End"
                              className={inputClass}
                            />
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label="Remove education"
                        onClick={() =>
                          setSchema((s) => ({
                            ...s,
                            education: s.education.filter((_, j) => j !== i),
                          }))
                        }
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setSchema((s) => ({
                    ...s,
                    education: [...s.education, { institution: "" }],
                  }))
                }
                className="flex items-center gap-1.5 text-sm font-medium text-[#2f40df] hover:underline"
              >
                <PlusIcon className="h-5 w-5" />
                Add education
              </button>
            </div>
          )}

          {/* Skills */}
          {step === "Skills" && (
            <div className="space-y-3">
              {schema.skills.length === 0 && (
                <p className="text-sm text-slate-500">Add a skill group (e.g. Technical, Soft skills).</p>
              )}
              {schema.skills.map((g, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/30 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-2">
                      <input
                        value={g.name}
                        onChange={(e) =>
                          setSchema((s) => ({
                            ...s,
                            skills: s.skills.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                          }))
                        }
                        placeholder="Group name (e.g. Technical)"
                        className={inputClass}
                      />
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">Keywords (comma or newline separated)</label>
                        <textarea
                          value={g.keywords.join(", ")}
                          onChange={(e) =>
                            setSchema((s) => ({
                              ...s,
                              skills: s.skills.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      keywords: e.target.value
                                        .split(/[,\n]/)
                                        .map((k) => k.trim())
                                        .filter(Boolean),
                                    }
                                  : x
                              ),
                            }))
                          }
                          rows={3}
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Remove skill group"
                      onClick={() =>
                        setSchema((s) => ({
                          ...s,
                          skills: s.skills.filter((_, j) => j !== i),
                        }))
                      }
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setSchema((s) => ({
                    ...s,
                    skills: [...s.skills, { name: "", keywords: [], level: null }],
                  }))
                }
                className="flex items-center gap-1.5 text-sm font-medium text-[#2f40df] hover:underline"
              >
                <PlusIcon className="h-5 w-5" />
                Add skill group
              </button>
            </div>
          )}

          {/* Summary */}
          {step === "Summary" && (
            <textarea
              value={schema.basics.summary ?? ""}
              onChange={(e) => setSchema((s) => ({ ...s, basics: { ...s.basics, summary: e.target.value } }))}
              placeholder="Professional summary"
              rows={8}
              className={inputClass}
            />
          )}

          {/* Finalize */}
          {step === "Finalize" && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Languages</p>
                {schema.languages.length === 0 && (
                  <p className="mb-2 text-xs text-slate-500">Optional — add spoken languages for the sidebar.</p>
                )}
                <div className="space-y-2">
                  {schema.languages.map((lang, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input
                        value={lang.language}
                        onChange={(e) =>
                          setSchema((s) => ({
                            ...s,
                            languages: s.languages.map((x, j) =>
                              j === i ? { ...x, language: e.target.value } : x
                            ),
                          }))
                        }
                        placeholder="Language"
                        className={`${inputClass} max-w-[140px]`}
                      />
                      <input
                        value={lang.fluency ?? ""}
                        onChange={(e) =>
                          setSchema((s) => ({
                            ...s,
                            languages: s.languages.map((x, j) =>
                              j === i ? { ...x, fluency: e.target.value || null } : x
                            ),
                          }))
                        }
                        placeholder="Level (e.g. C1)"
                        className={`${inputClass} max-w-[120px]`}
                      />
                      <button
                        type="button"
                        aria-label="Remove language"
                        onClick={() =>
                          setSchema((s) => ({
                            ...s,
                            languages: s.languages.filter((_, j) => j !== i),
                          }))
                        }
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setSchema((s) => ({
                        ...s,
                        languages: [...s.languages, { language: "" }],
                      }))
                    }
                    className="flex items-center gap-1.5 text-sm font-medium text-[#2f40df] hover:underline"
                  >
                    <PlusIcon className="h-5 w-5" />
                    Add language
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={async () => {
                    if (!templateId) return;
                    setError(null);
                    try {
                      const res = await adminRenderTemplatePdf({ template_id: templateId, schema: renderSchema });
                      setPdfPageCount(res.page_count);
                      setPdfWarnings(res.warnings);
                      const url = URL.createObjectURL(b64ToBlob(res.pdf_base64));
                      window.open(url, "_blank", "noopener,noreferrer");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  disabled={!templateId}
                  className="rounded-xl bg-[#2f40df] px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                >
                  Open PDF
                </button>
                {pdfPageCount != null && (
                  <span className="text-xs text-slate-500">
                    {pdfPageCount} page{pdfPageCount === 1 ? "" : "s"}
                    {pdfWarnings.length > 0 ? ` · ${pdfWarnings.join("; ")}` : ""}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Footer nav */}
          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={stepIndex <= 0}
              onClick={() => prevStep && setStep(prevStep)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
            >
              Back
            </button>
            {stepIndex < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => nextStep && setStep(nextStep)}
                className="rounded-xl bg-[#2f40df] px-5 py-2 text-sm font-semibold text-white shadow-sm"
              >
                Next: {nextStep}
              </button>
            ) : (
              <span className="text-xs text-slate-400">Откройте PDF на этом шаге или правьте данные слева.</span>
            )}
          </div>
        </div>

        {/* —— Preview: unified card with attached header —— */}
        <div className="flex min-h-[50vh] w-full min-w-0 flex-col xl:sticky xl:top-4 xl:min-h-[calc(100vh-6rem)]">
          <div className="w-full min-w-0 rounded-t-2xl border border-slate-200/90 bg-white">
            <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <span
                    className={`inline-flex min-w-[44px] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold ${
                      resumeScore >= 85
                        ? "bg-emerald-100 text-emerald-700"
                        : resumeScore >= 65
                          ? "bg-amber-100 text-amber-700"
                          : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {resumeScore}%
                  </span>
                  <span className="truncate">Your resume score</span>
                </p>
                {loadingPreview && <p className="mt-0.5 text-xs text-slate-400">Updating preview...</p>}
              </div>
              <div ref={templateMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setTemplateMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Change template
                  <ChevronDownIcon className={`h-4 w-4 transition ${templateMenuOpen ? "rotate-180" : ""}`} />
                </button>
                {templateMenuOpen && (
                  <div className="absolute right-0 z-20 mt-2 w-72 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setTemplateId(t.id);
                          // Force immediate refresh even when selecting the same template id.
                          setCommitPreviewTick((v) => v + 1);
                          setTemplateMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                          templateId === t.id ? "bg-[#eef1ff] text-[#1e2a7c]" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="font-medium">{t.name}</span>
                        <span className="text-xs text-slate-500">{Math.round(t.pdf_stability_score * 100)}%</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="-mt-px w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden">
            <div ref={previewCanvasHostRef} className="w-full min-w-0">
              <div className="space-y-3">
                {previewPages.map((p) => (
                  <img
                    key={p.page}
                    src={p.src}
                    alt={`Resume preview page ${p.page}`}
                    className="mt-0 block w-full border border-slate-200 bg-white shadow-[0_14px_30px_-12px_rgba(15,23,42,0.24)]"
                  />
                ))}
                {!loadingPreview && previewPages.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                    Preview will appear here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
