import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  DocumentTextIcon,
  PencilSquareIcon,
  PlusIcon,
  ArrowDownTrayIcon,
  EyeIcon,
  TrashIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t, tFormat } from "../i18n";

const ADD_RESUME_ACCEPT = ".txt,.md,.html,.htm,.tex,.pdf,.doc,.docx";
const ADD_RESUME_EXTS = ["txt", "md", "html", "htm", "tex", "pdf", "doc", "docx"];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return t("home.today");
  if (diffDays === 1) return t("home.yesterday");
  if (diffDays < 30) return tFormat(t("home.daysAgo"), { n: String(diffDays) });
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return t("home.monthAgo");
  if (diffMonths < 12) return tFormat(t("home.monthsAgo"), { n: String(diffMonths) });
  const diffYears = Math.floor(diffDays / 365);
  return diffYears === 1 ? t("home.yearAgo") : tFormat(t("home.yearsAgo"), { n: String(diffYears) });
}

type ResumeCardItem = api.HistoryItem & { optimizedItem?: api.HistoryItem };

/** Уникальные «исходные» резюме по source_checksum; при отсутствии checksum считаем каждый item отдельно */
function useResumeDocuments() {
  const [items, setItems] = useState<api.HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setLoading(true);
    api
      .getHistory()
      .then((r) => setItems(Array.isArray(r.items) ? r.items : []))
      .catch((e) => setError(e instanceof Error ? e.message : t("home.loadError")))
      .finally(() => setLoading(false));
  }, [refresh]);

  const list = Array.isArray(items) ? items : [];

  // Group by source_checksum: track latest upload + latest optimized per source
  type Group = { upload: api.HistoryItem | null; optimized: api.HistoryItem | null };
  const groups = new Map<string, Group>();
  for (const item of list) {
    const key = item.source_checksum ?? item.filename;
    if (!groups.has(key)) groups.set(key, { upload: null, optimized: null });
    const g = groups.get(key)!;
    const isUpload = item.source_was_pdf === true && item.filename.startsWith("uploaded_");
    if (isUpload) {
      if (!g.upload || new Date(item.timestamp) > new Date(g.upload.timestamp)) g.upload = item;
    } else {
      if (!g.optimized || new Date(item.timestamp) > new Date(g.optimized.timestamp)) g.optimized = item;
    }
  }

  /** In «My resumes» block — uploaded originals, enriched with latest optimized version */
  const documents: ResumeCardItem[] = Array.from(groups.values())
    .filter((g) => g.upload !== null)
    .map((g) => ({ ...g.upload!, ...(g.optimized ? { optimizedItem: g.optimized } : {}) }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  /** In «Edit history» block — improved/tailored resumes (groups without an upload) */
  const editedDocuments = Array.from(groups.values())
    .filter((g) => g.upload === null && g.optimized !== null)
    .map((g) => g.optimized!)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return { documents, editedDocuments, loading, error, refetch: () => setRefresh((r) => r + 1) };
}

export default function Home() {
  const navigate = useNavigate();
  const { documents, editedDocuments, loading, error, refetch } = useResumeDocuments();
  const { user, refreshUser } = useAuth();
  const [thumbnailErrors, setThumbnailErrors] = useState<Set<string>>(new Set());
  const [addUploading, setAddUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ filename: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [improvingFilename, setImprovingFilename] = useState<string | null>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await api.deleteHistory(deleteConfirm.filename);
      refetch();
      setDeleteConfirm(null);
    } catch (e) {
      // keep popup open; could set error state
    } finally {
      setDeleting(false);
    }
  };

  const handleImproveHistoryItem = async (item: api.HistoryItem, e: React.MouseEvent) => {
    e.preventDefault();
    if (improvingFilename) return;
    setImprovingFilename(item.filename);
    try {
      const content = await api.getHistoryOriginalText(item.filename);
      navigate("/optimize", {
        state: { resumeContent: content, uploadedFileName: item.filename, sourceWasPdf: item.source_was_pdf }
      });
    } catch {
      navigate("/optimize");
    } finally {
      setImprovingFilename(null);
    }
  };

  async function handleAddFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !ADD_RESUME_EXTS.includes(ext)) return;
    setAddUploading(true);
    try {
      let content: string;
      let sourceWasPdf = false;
      let uploadedFileName = file.name;
      if (ext === "pdf") {
        const res = await api.parseResumePdf(file);
        content = res.content ?? "";
        sourceWasPdf = true;
        if (user) {
          const upRes = await api.registerResumeUpload(file);
          uploadedFileName = upRes.filename;
          await refreshUser();
        }
      } else if (ext === "docx" || ext === "doc") {
        const res = await api.parseResumeDocx(file);
        content = res.content ?? "";
      } else {
        content = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
          r.onerror = () => reject(new Error(t("home.readFileError")));
          r.readAsText(file, "UTF-8");
        });
      }
      navigate("/optimize", {
        state: { resumeContent: content, uploadedFileName: uploadedFileName, sourceWasPdf },
        replace: false,
      });
    } catch {
      setAddUploading(false);
    } finally {
      setAddUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Banner: Resume match score — same block style as other sections */}
      <Link
        to="/optimize"
        className="block rounded-2xl border border-[#EBEDF5] bg-white overflow-hidden focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 px-5 py-4 sm:p-5">
          <div className="flex items-start gap-4 min-w-0">
            <div className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-[#F5F6FA] border border-[#EBEDF5] text-[#6366f1]">
              <ChartBarIcon className="w-6 h-6" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-[#181819]">
                {t("home.resumeMatchScore")}
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-0.5 leading-relaxed max-w-xl">
                {t("home.resumeMatchDesc")}
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold text-[#4578FC] bg-transparent border-2 border-[#4578FC] transition-colors hover:bg-[#4578FC]/5">
              {t("home.checkChance")}
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
          </div>
        </div>
      </Link>

      {/* Section: My resumes — cards with preview and Add */}
      <section className="rounded-2xl border border-[#EBEDF5] bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-[#EBEDF5]">
          <h2 className="text-base font-semibold text-[#181819]">{t("home.myResumes")}</h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">{t("home.myResumesDesc")}</p>
        </div>
        <div className="p-5">
          {loading && (
            <p className="text-sm text-[var(--text-muted)] py-8">{t("home.loading")}</p>
          )}
          {error && (
            <p className="text-sm text-red-600 py-8" role="alert">{error}</p>
          )}
          {!loading && !error && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {documents.slice(0, 10).map((item) => {
                const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || t("home.noName");
                const previewFilename = item.optimizedItem?.filename ?? item.filename;
                const openFilename = item.optimizedItem?.filename ?? item.filename;
                const qualityScore = item.optimizedItem?.post_ats_score ?? null;
                return (
                  <article
                    key={item.filename}
                    className="flex gap-3 rounded-xl p-2.5 hover:bg-[#F5F6FA] transition-colors min-w-0"
                  >
                    {/* Превью в пропорциях A4 (210×297) */}
                    <div className="shrink-0 w-44 min-w-0 rounded-md bg-white overflow-hidden flex flex-col relative aspect-[210/297] group/preview">
                      <a
                        href={api.historyOpenUrl(openFilename, api.getStoredToken())}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 transition-colors group-hover/preview:bg-black/30 rounded-md"
                        aria-label={t("home.open")}
                        title={t("home.open")}
                      >
                        <span className="opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center w-8 h-8 rounded-full bg-white/95 text-[#181819] shadow-sm">
                          <EyeIcon className="w-4 h-4" />
                        </span>
                      </a>
                      {thumbnailErrors.has(previewFilename) ? (
                        <>
                          <div className="h-5 bg-[#EEF1FC] flex items-center px-1.5 gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#c8cddc]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#c8cddc]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#c8cddc]" />
                          </div>
                          <div className="flex-1 p-1.5 flex flex-col justify-center">
                            <DocumentTextIcon className="w-6 h-6 text-[#4578FC]/60 mx-auto mb-1" />
                            <p className="text-[9px] font-semibold text-[#181819] uppercase tracking-wide text-center truncate">
                              {name}
                            </p>
                          </div>
                        </>
                      ) : (
                        <img
                          src={api.historyThumbnailUrl(previewFilename, api.getStoredToken())}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover object-top"
                          onError={() => setThumbnailErrors((s) => new Set(s).add(previewFilename))}
                        />
                      )}
                    </div>
                    {/* Название, дата, плашка качества, кнопки вертикально */}
                    <div className="min-w-0 flex-1 flex flex-col py-0.5">
                      <h3 className="text-[13px] font-semibold text-[#181819] truncate leading-tight">{name}</h3>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {formatRelative(item.timestamp)}
                      </p>
                      {qualityScore != null && (
                        <div className="mt-1.5 inline-flex items-center gap-1 self-start px-1.5 py-0.5 rounded bg-[#217d47]/10">
                          <span className="text-[11px] font-semibold text-[#217d47]">{qualityScore}%</span>
                          <span className="text-[10px] text-[#217d47]/80">{t("home.resumeQuality")}</span>
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5 mt-1.5">
                        <button
                          type="button"
                          onClick={(e) => handleImproveHistoryItem(item, e)}
                          disabled={improvingFilename === item.filename}
                          className="inline-flex items-center gap-1.5 p-1 rounded text-xs font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] transition-colors disabled:opacity-50 text-left"
                        >
                          {improvingFilename === item.filename ? (
                            <span className="w-3.5 h-3.5 border border-[#4578FC]/30 border-t-[#4578FC] rounded-full animate-spin shrink-0" aria-hidden />
                          ) : (
                            <PencilSquareIcon className="w-4 h-4 shrink-0" />
                          )}
                          {t("home.improve")}
                        </button>
                        <a
                          href={api.downloadUrl(item.filename, api.getStoredToken())}
                          download={item.filename}
                          className="inline-flex items-center gap-1.5 p-1 rounded text-xs font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] transition-colors"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4 shrink-0" />
                          {t("home.downloadPdf")}
                        </a>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm({ filename: item.filename, name })}
                          className="inline-flex items-center gap-1.5 p-1 rounded text-xs font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-red-600 transition-colors text-left"
                        >
                          <TrashIcon className="w-4 h-4 shrink-0" />
                          {t("home.delete")}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              <input
                ref={addFileInputRef}
                type="file"
                accept={ADD_RESUME_ACCEPT}
                className="hidden"
                onChange={handleAddFile}
                aria-label={t("home.uploadResume")}
              />
              <button
                type="button"
                onClick={() => addFileInputRef.current?.click()}
                disabled={addUploading}
                className="flex gap-3 rounded-xl p-2.5 hover:bg-[#F5F6FA] transition-colors text-left disabled:opacity-60 disabled:cursor-wait group/add"
              >
                {/* A4-shaped dashed area — same proportions as resume preview */}
                <div className="shrink-0 w-44 aspect-[210/297] rounded-md border-2 border-dashed border-[#c8cddc] group-hover/add:border-[#4578FC]/50 transition-colors flex items-center justify-center">
                  {addUploading ? (
                    <span className="h-7 w-7 border-2 border-[#4578FC]/30 border-t-[#4578FC] rounded-full animate-spin" aria-hidden />
                  ) : (
                    <span className="w-12 h-12 rounded-full bg-[#F0F2FA] group-hover/add:bg-[#EEF1FC] flex items-center justify-center transition-colors">
                      <PlusIcon className="w-6 h-6 text-[#9aa3b8] group-hover/add:text-[#4578FC] transition-colors" strokeWidth={2} />
                    </span>
                  )}
                </div>
                {/* Text block */}
                <div className="min-w-0 flex-1 flex flex-col justify-start py-0.5 gap-1">
                  <h3 className="text-[13px] font-semibold text-[var(--text-muted)] leading-tight">
                    {addUploading ? t("home.uploading") : t("home.importResume")}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] leading-snug">{t("home.importResumeDescLine1")}<br />{t("home.importResumeDescLine2")}</p>
                </div>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => !deleting && setDeleteConfirm(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
        >
          <div
            className="rounded-2xl border border-[#EBEDF5] bg-white shadow-xl max-w-sm w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-dialog-title" className="text-base font-semibold text-[#181819]">
              {t("home.deleteConfirmTitle")}
            </h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {tFormat(t("home.deleteConfirmBody"), { name: deleteConfirm.name })}
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => !deleting && setDeleteConfirm(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-xl border border-[#EBEDF5] bg-[#F5F6FA] text-sm font-medium text-[#181819] hover:bg-[#EBEDF5] transition-colors disabled:opacity-60"
              >
                {t("home.cancel")}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                {deleting ? (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden />
                ) : (
                  <TrashIcon className="w-4 h-4" />
                )}
                {t("home.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
