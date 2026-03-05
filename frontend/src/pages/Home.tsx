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

const ADD_RESUME_ACCEPT = ".txt,.md,.html,.htm,.tex,.pdf,.doc,.docx";
const ADD_RESUME_EXTS = ["txt", "md", "html", "htm", "tex", "pdf", "doc", "docx"];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  if (diffDays < 30) return `${diffDays} дн. назад`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 мес. назад";
  if (diffMonths < 12) return `${diffMonths} мес. назад`;
  const diffYears = Math.floor(diffDays / 365);
  return diffYears === 1 ? "1 год назад" : `${diffYears} г. назад`;
}

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
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [refresh]);

  const byChecksum = new Map<string, api.HistoryItem>();
  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    const key = item.source_checksum ?? item.filename;
    if (!byChecksum.has(key)) byChecksum.set(key, item);
  }
  const allDocuments = Array.from(byChecksum.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  /** В блоке «Мои резюме» — только загруженные с компьютера (register-upload), без улучшенных */
  const documents = allDocuments.filter(
    (d) => d.source_was_pdf === true && d.filename.startsWith("uploaded_")
  );
  /** В блоке «История улучшений» — улучшенные/отредактированные резюме (всё остальное) */
  const editedDocuments = allDocuments.filter(
    (d) => !(d.source_was_pdf === true && d.filename.startsWith("uploaded_"))
  );

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
      if (ext === "pdf") {
        const res = await api.parseResumePdf(file);
        content = res.content ?? "";
        sourceWasPdf = true;
        if (user) {
          await api.registerResumeUpload(file);
          await refreshUser();
        }
      } else if (ext === "docx" || ext === "doc") {
        const res = await api.parseResumeDocx(file);
        content = res.content ?? "";
      } else {
        content = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
          r.onerror = () => reject(new Error("Не удалось прочитать файл"));
          r.readAsText(file, "UTF-8");
        });
      }
      navigate("/optimize", {
        state: { resumeContent: content, uploadedFileName: file.name, sourceWasPdf },
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
      {/* Карточка перехода к улучшению резюме */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          to="/optimize"
          className="rounded-2xl border border-[#EBEDF5] bg-white p-5 text-left transition-all duration-200 hover:border-[#c8cddc] hover:bg-[#FAFBFC]"
        >
          <div className="flex items-center gap-4">
            <div className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-[#F0F2F8] text-[#5e7acc]">
              <ChartBarIcon className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <span className="block text-[15px] font-medium tracking-tight text-[#181819]">
                Резюме метч скор
              </span>
              <span className="block text-[13px] text-[var(--text-muted)] mt-0.5 leading-snug">
                Проверить шанс на интервью
              </span>
            </div>
          </div>
        </Link>
      </div>

      {/* Блок: Мои резюме — карточки с превью и кнопками + пунктирная карточка «Добавить» */}
      <section className="rounded-2xl border border-[#EBEDF5] bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-[#EBEDF5]">
          <h2 className="text-base font-semibold text-[#181819]">Мои резюме</h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Резюме, загруженные в формате PDF</p>
        </div>
        <div className="p-5">
          {loading && (
            <p className="text-sm text-[var(--text-muted)] py-8">Загрузка…</p>
          )}
          {error && (
            <p className="text-sm text-red-600 py-8" role="alert">{error}</p>
          )}
          {!loading && !error && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {documents.slice(0, 10).map((item) => {
                const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || "Без названия";
                return (
                  <article
                    key={item.filename}
                    className="flex gap-2 rounded-xl p-2 hover:bg-[#F5F6FA] transition-colors min-w-0"
                  >
                    {/* Превью в пропорциях A4 (210×297) */}
                    <div className="shrink-0 w-24 min-w-0 rounded-md bg-white overflow-hidden flex flex-col relative aspect-[210/297] group/preview">
                      <a
                        href={api.historyOpenUrl(item.filename, api.getStoredToken())}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 transition-colors group-hover/preview:bg-black/30 rounded-md"
                        aria-label="Открыть резюме"
                        title="Открыть"
                      >
                        <span className="opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center w-7 h-7 rounded-full bg-white/95 text-[#181819] shadow-sm">
                          <EyeIcon className="w-4 h-4" />
                        </span>
                      </a>
                      {thumbnailErrors.has(item.filename) ? (
                        <>
                          <div className="h-4 bg-[#EEF1FC] flex items-center px-1 gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-[#c8cddc]" />
                            <span className="w-1 h-1 rounded-full bg-[#c8cddc]" />
                            <span className="w-1 h-1 rounded-full bg-[#c8cddc]" />
                          </div>
                          <div className="flex-1 p-1 flex flex-col justify-center">
                            <DocumentTextIcon className="w-5 h-5 text-[#4578FC]/60 mx-auto mb-0.5" />
                            <p className="text-[8px] font-semibold text-[#181819] uppercase tracking-wide text-center truncate">
                              {name}
                            </p>
                          </div>
                        </>
                      ) : (
                        <img
                          src={api.historyThumbnailUrl(item.filename, api.getStoredToken())}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover object-top"
                          onError={() => setThumbnailErrors((s) => new Set(s).add(item.filename))}
                        />
                      )}
                    </div>
                    {/* Название, дата, кнопки вертикально */}
                    <div className="min-w-0 flex-1 flex flex-col py-0.5">
                      <h3 className="text-[11px] font-semibold text-[#181819] truncate leading-tight">{name}</h3>
                      <p className="text-[9px] text-[var(--text-muted)] mt-0.5">
                        {formatRelative(item.timestamp)}
                      </p>
                      <div className="flex flex-col gap-0.5 mt-1.5">
                        <Link
                          to="/optimize"
                          className="inline-flex items-center gap-1 p-1 rounded text-[9px] font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] transition-colors"
                        >
                          <PencilSquareIcon className="w-2.5 h-2.5 shrink-0" />
                          Улучшить
                        </Link>
                        <a
                          href={api.downloadUrl(item.filename, api.getStoredToken())}
                          download={item.filename}
                          className="inline-flex items-center gap-1 p-1 rounded text-[9px] font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] transition-colors"
                        >
                          <ArrowDownTrayIcon className="w-2.5 h-2.5 shrink-0" />
                          Скачать PDF
                        </a>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm({ filename: item.filename, name })}
                          className="inline-flex items-center gap-1 p-1 rounded text-[9px] font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-red-600 transition-colors text-left"
                        >
                          <TrashIcon className="w-2.5 h-2.5 shrink-0" />
                          Удалить
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {/* Карточка «Добавить» — сразу открывает выбор файла с компьютера; после загрузки редирект на оптимизацию, шаг 2 */}
              <input
                ref={addFileInputRef}
                type="file"
                accept={ADD_RESUME_ACCEPT}
                className="hidden"
                onChange={handleAddFile}
                aria-label="Загрузить резюме с компьютера"
              />
              <button
                type="button"
                onClick={() => addFileInputRef.current?.click()}
                disabled={addUploading}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl min-h-0 w-full aspect-[210/297] max-h-[6.5rem] border border-dashed border-[#c8cddc] hover:border-[#4578FC]/50 hover:bg-[#F5F6FA] transition-colors text-[var(--text-muted)] hover:text-[#4578FC] disabled:opacity-60 disabled:cursor-wait"
              >
                {addUploading ? (
                  <span className="h-5 w-5 border-2 border-[#4578FC]/30 border-t-[#4578FC] rounded-full animate-spin" aria-hidden />
                ) : (
                  <PlusIcon className="w-5 h-5 text-[#4578FC]" strokeWidth={2} />
                )}
                <span className="text-[10px] font-medium">{addUploading ? "Загрузка…" : "Добавить"}</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Блок: История улучшений — отредактированные резюме с превью и должностью */}
      {editedDocuments.length > 0 && (
        <section className="rounded-2xl border border-[#EBEDF5] bg-white overflow-hidden" aria-labelledby="edited-heading">
          <div className="px-5 py-4 border-b border-[#EBEDF5]">
            <h2 id="edited-heading" className="text-base font-semibold text-[#181819]">История улучшений</h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Резюме, отредактированные под вакансии</p>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {editedDocuments.slice(0, 12).map((item) => {
                const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || "Резюме";
                return (
                  <article
                    key={item.filename}
                    className="flex gap-2 rounded-xl p-2 hover:bg-[#F5F6FA] transition-colors min-w-0"
                  >
                    <div className="shrink-0 w-24 min-w-0 rounded-md bg-white overflow-hidden flex flex-col relative aspect-[210/297] group/preview">
                      <a
                        href={api.historyOpenUrl(item.filename, api.getStoredToken())}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 transition-colors group-hover/preview:bg-black/30 rounded-md"
                        aria-label="Открыть резюме"
                        title="Открыть"
                      >
                        <span className="opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center w-7 h-7 rounded-full bg-white/95 text-[#181819] shadow-sm">
                          <EyeIcon className="w-4 h-4" />
                        </span>
                      </a>
                      {thumbnailErrors.has(item.filename) ? (
                        <>
                          <div className="h-4 bg-[#EEF1FC] flex items-center px-1 gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-[#c8cddc]" />
                            <span className="w-1 h-1 rounded-full bg-[#c8cddc]" />
                            <span className="w-1 h-1 rounded-full bg-[#c8cddc]" />
                          </div>
                          <div className="flex-1 p-1 flex flex-col justify-center">
                            <DocumentTextIcon className="w-5 h-5 text-[#4578FC]/60 mx-auto mb-0.5" />
                            <p className="text-[8px] font-semibold text-[#181819] uppercase tracking-wide text-center truncate">
                              {name}
                            </p>
                          </div>
                        </>
                      ) : (
                        <img
                          src={api.historyThumbnailUrl(item.filename, api.getStoredToken())}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover object-top"
                          onError={() => setThumbnailErrors((s) => new Set(s).add(item.filename))}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 flex flex-col py-0.5">
                      <h3 className="text-[11px] font-semibold text-[#181819] truncate leading-tight">{name}</h3>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5 line-clamp-2" title={item.job_title || undefined}>
                        {item.job_title || "—"}
                      </p>
                      <p className="text-[9px] text-[var(--text-muted)] mt-1">
                        {formatRelative(item.timestamp)}
                      </p>
                      <div className="flex flex-col gap-0.5 mt-1.5">
                        <a
                          href={api.downloadUrl(item.filename, api.getStoredToken())}
                          download={item.filename}
                          className="inline-flex items-center gap-1 p-1 rounded text-[9px] font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] transition-colors"
                        >
                          <ArrowDownTrayIcon className="w-2.5 h-2.5 shrink-0" />
                          Скачать PDF
                        </a>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm({ filename: item.filename, name })}
                          className="inline-flex items-center gap-1 p-1 rounded text-[9px] font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-red-600 transition-colors text-left"
                        >
                          <TrashIcon className="w-2.5 h-2.5 shrink-0" />
                          Удалить
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Попап подтверждения удаления */}
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
              Удалить резюме?
            </h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Резюме «{deleteConfirm.name}» будет удалено. Это действие нельзя отменить.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => !deleting && setDeleteConfirm(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-xl border border-[#EBEDF5] bg-[#F5F6FA] text-sm font-medium text-[#181819] hover:bg-[#EBEDF5] transition-colors disabled:opacity-60"
              >
                Отмена
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
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
