import { useEffect, useState, useMemo } from "react";
import { Disclosure, DisclosureButton, DisclosurePanel, Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import {
  ArrowDownTrayIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentArrowDownIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";
import * as api from "../api";

type PeriodFilter = "all" | "month" | "week";

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: "all", label: "Всё время" },
  { value: "month", label: "Последний месяц" },
  { value: "week", label: "Последняя неделя" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function CompanyCell({ item }: { item: api.HistoryItem }) {
  const initial = item.company ? item.company.trim().slice(0, 1).toUpperCase() : "?";
  const name = item.company || "—";
  return (
    <div className="flex min-w-0 items-center gap-3">
      {item.company_logo_url ? (
        <img
          src={item.company_logo_url}
          alt=""
          className="h-8 w-8 shrink-0 rounded-lg object-contain bg-[#F5F6FA]"
        />
      ) : (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F5F6FA] text-xs font-semibold text-[#4578FC]"
          aria-hidden
        >
          {initial}
        </div>
      )}
      <span className="min-w-0 truncate text-xs font-medium" title={name}>{name}</span>
    </div>
  );
}

function ScoresCell({ item }: { item: api.HistoryItem }) {
  const preAts = item.pre_ats_score;
  const postAts = item.post_ats_score;
  const preKw = item.pre_keyword_score != null ? Math.round(item.pre_keyword_score * 100) : null;
  const postKw = item.post_keyword_score != null ? Math.round(item.post_keyword_score * 100) : null;
  if (preAts == null && postAts == null && preKw == null && postKw == null) {
    return <span className="text-[var(--text-muted)]">—</span>;
  }
  return (
    <div className="min-w-0 flex flex-col gap-0.5 truncate text-xs">
      {preAts != null && postAts != null && (
        <span className="truncate">ATS: {preAts}% → {postAts}%</span>
      )}
      {preKw != null && postKw != null && (
        <span className="truncate text-[var(--text-muted)]">Ключ.: {preKw}% → {postKw}%</span>
      )}
    </div>
  );
}

export default function History() {
  const [items, setItems] = useState<api.HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    api
      .getHistory()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  /** Только улучшенные резюме (не загруженные PDF) */
  const latest = useMemo(
    () => items.filter((i) => i.source_was_pdf !== true).slice(0, 4),
    [items]
  );

  const filtered = useMemo(() => {
    let list = items;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          i.company.toLowerCase().includes(q) ||
          (i.job_title && i.job_title.toLowerCase().includes(q))
      );
    }
    if (period === "week") {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      list = list.filter((i) => new Date(i.timestamp) >= weekAgo);
    } else if (period === "month") {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      list = list.filter((i) => new Date(i.timestamp) >= monthAgo);
    }
    return list;
  }, [items, search, period]);

  const handleDelete = async (filename: string) => {
    if (!confirm("Удалить запись из истории?")) return;
    setDeleting(filename);
    try {
      await api.deleteHistory(filename);
      setItems((prev) => prev.filter((i) => i.filename !== filename));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]" role="status" aria-live="polite">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
        Загрузка…
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {latest.length > 0 && (
        <section aria-labelledby="latest-heading" className="space-y-4">
          <h2 id="latest-heading" className="text-base font-semibold text-[var(--text)]">Последние резюме</h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Только улучшенные резюме</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {latest.map((item) => (
              <article
                key={item.filename}
                className="flex flex-col rounded-2xl border border-[#EBEDF5] bg-[var(--card)] p-5 transition-colors hover:border-[#4578FC]/40 hover:bg-[#F5F6FA]/80"
              >
                <p className="truncate text-base font-semibold text-[var(--text)]" title={item.job_title || undefined}>
                  {item.job_title || "—"}
                </p>
                <p className="mt-1 truncate text-sm text-[var(--text-muted)]" title={item.company}>
                  {item.company || "—"}
                </p>
                <p className="mt-2 text-xs tabular-nums text-[var(--text-muted)]">
                  {formatDate(item.timestamp)}
                </p>
                <div className="mt-4 flex gap-2">
                  <a
                    href={api.downloadUrl(item.filename, api.getStoredToken())}
                    download={item.filename}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#EBEDF5] bg-[#F5F6FA] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[#4578FC] hover:bg-[#4578FC] hover:text-white"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
                    PDF
                  </a>
                  <a
                    href={api.historyOpenUrl(item.filename, api.getStoredToken())}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#EBEDF5] bg-[#F5F6FA] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[#4578FC] hover:bg-[#4578FC]/10 hover:text-[#4578FC]"
                  >
                    <EyeIcon className="h-4 w-4" aria-hidden />
                    Открыть
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="all-history-heading" className="space-y-4">
        <h2 id="all-history-heading" className="text-base font-semibold text-[var(--text)]">Вся история</h2>
        <div className="rounded-2xl border border-[#EBEDF5] bg-white overflow-hidden">
          {/* Тулбар: поиск + период — в стиле сайта */}
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#EBEDF5] px-5 py-4 bg-[#F5F6FA]/50">
            <div className="min-w-0 flex-1 max-w-xs">
              <label htmlFor="history-search" className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                Поиск
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
                <input
                  id="history-search"
                  type="search"
                  placeholder="Компания или должность…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#EBEDF5] bg-white py-2 pl-9 pr-3 text-sm text-[#181819] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:border-[#4578FC]"
                  aria-label="Поиск по таблице истории"
                />
              </div>
            </div>
            <Listbox value={period} onChange={setPeriod}>
              <div className="flex flex-col">
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                  <CalendarDaysIcon className="h-3.5 w-3.5" />
                  Период
                </label>
                <div className="relative">
                  <ListboxButton
                    aria-label="Период"
                    className="flex items-center gap-2 h-10 min-w-[11rem] rounded-xl border border-[#EBEDF5] bg-white px-3 pr-9 text-left text-sm text-[#181819] transition-colors hover:border-[#E0E2E8] hover:bg-[#FAFBFC] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:border-[#4578FC]/50"
                  >
                    <span className="block truncate">
                      {PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period}
                    </span>
                    <ChevronDownIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none" aria-hidden />
                  </ListboxButton>
                  <ListboxOptions
                    anchor="bottom end"
                    className="z-20 mt-1.5 min-w-[11rem] rounded-xl border border-[#EBEDF5] bg-white py-1 shadow-[0_4px_12px_rgba(0,0,0,0.06)] focus:outline-none [--anchor-gap:4px]"
                  >
                    {PERIOD_OPTIONS.map((opt) => (
                      <ListboxOption
                        key={opt.value}
                        value={opt.value}
                        className="cursor-pointer py-2.5 px-3 text-sm text-[#181819] data-[focus]:bg-[#F5F6FA] data-[selected]:bg-[#EBEDF5] data-[selected]:font-medium data-[selected]:text-[#181819]"
                      >
                        {opt.label}
                      </ListboxOption>
                    ))}
                  </ListboxOptions>
                </div>
              </div>
            </Listbox>
          </div>

          {/* Сетка: пропорциональные колонки, компактно, без переносов */}
          <div
            className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.6fr)_4.5rem_minmax(0,0.9fr)_6rem] gap-x-3 px-5 py-2.5 border-b border-[#EBEDF5] bg-[#F5F6FA]/70 text-xs font-medium text-[var(--text-muted)]"
            aria-hidden
          >
            <span />
            <span>Компания</span>
            <span>Резюме</span>
            <span>Должность</span>
            <span>Дата</span>
            <span>Показатели</span>
            <span className="text-right">Действия</span>
          </div>
          <ul className="divide-y divide-[#EBEDF5]" aria-label="История сгенерированных резюме">
            {filtered.length > 0 ? (
              filtered.map((item) => {
                const personName = [item.first_name, item.last_name].filter(Boolean).join(" ") || "—";
                return (
                  <Disclosure key={item.filename} as="li">
                    {({ open }) => (
                      <>
                        <DisclosureButton
                          as="div"
                          role="button"
                          tabIndex={0}
                          className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.6fr)_4.5rem_minmax(0,0.9fr)_6rem] gap-x-3 w-full items-center px-5 py-2.5 text-left text-sm transition-colors hover:bg-[#F5F6FA]/80 focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-inset rounded-none cursor-pointer"
                          aria-expanded={open}
                        >
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-transform duration-200 ${open ? "rotate-90 bg-[#EBEDF5]" : "bg-transparent"}`}
                            aria-hidden
                          >
                            <ChevronRightIcon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex items-center gap-2 truncate">
                            <CompanyCell item={item} />
                          </div>
                          <span className="min-w-0 truncate text-[#181819]" title={personName}>
                            {personName}
                          </span>
                          <span className="min-w-0 truncate text-[#181819]" title={item.job_title || undefined}>
                            {item.job_title || "—"}
                          </span>
                          <span className="tabular-nums text-xs text-[var(--text-muted)] shrink-0">
                            {formatDate(item.timestamp)}
                          </span>
                          <div className="min-w-0 truncate">
                            <ScoresCell item={item} />
                          </div>
                          <div
                            className="flex shrink-0 items-center justify-end gap-0.5"
                            onClick={(e) => e.stopPropagation()}
                            role="group"
                            aria-label="Действия"
                          >
                            <a
                              href={api.downloadUrl(item.filename, api.getStoredToken())}
                              download={item.filename}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-transparent text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30"
                              title="Скачать PDF"
                              aria-label="Скачать PDF"
                            >
                              <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                            </a>
                            <a
                              href={api.historyOpenUrl(item.filename, api.getStoredToken())}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-transparent text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30"
                              title="Открыть в браузере"
                              aria-label="Открыть в браузере"
                            >
                              <EyeIcon className="h-3.5 w-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDelete(item.filename); }}
                              disabled={deleting === item.filename}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-transparent text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 disabled:opacity-50"
                              title="Удалить"
                              aria-label="Удалить"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </DisclosureButton>
                        <DisclosurePanel className="border-t border-[#EBEDF5] bg-[#FAFBFC] px-5 py-3 pl-[3.25rem]">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            {(item.first_name || item.last_name) && (
                              <span className="rounded-lg bg-[#EBEDF5] px-2.5 py-1.5 text-[#181819]">
                                Кандидат: {[item.first_name, item.last_name].filter(Boolean).join(" ")}
                              </span>
                            )}
                            {item.job_url && (
                              <a
                                href={item.job_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#EBEDF5] bg-white px-2.5 py-1.5 text-[#181819] transition-colors hover:bg-[#F5F6FA] hover:border-[#E0E2E8] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30"
                              >
                                <LinkIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                Вакансия
                              </a>
                            )}
                            {item.source_checksum ? (
                              <a
                                href={api.historyOriginalUrl(item.filename)}
                                download
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#EBEDF5] bg-white px-2.5 py-1.5 text-[#181819] transition-colors hover:bg-[#F5F6FA] hover:border-[#E0E2E8] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30"
                              >
                                <DocumentArrowDownIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                Исходное .txt
                              </a>
                            ) : null}
                            <a
                              href={api.downloadUrl(item.filename, api.getStoredToken())}
                              download={item.filename}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#EBEDF5] bg-white px-2.5 py-1.5 text-[#181819] transition-colors hover:bg-[#F5F6FA] hover:border-[#E0E2E8] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30"
                            >
                              <ArrowDownTrayIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                              Скачать PDF
                            </a>
                            <a
                              href={api.historyOpenUrl(item.filename, api.getStoredToken())}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#EBEDF5] bg-white px-2.5 py-1.5 text-[#181819] transition-colors hover:bg-[#F5F6FA] hover:border-[#E0E2E8] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30"
                            >
                              <EyeIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                              Открыть
                            </a>
                          </div>
                        </DisclosurePanel>
                      </>
                    )}
                  </Disclosure>
                );
              })
            ) : (
              <li>
                <div className="flex flex-col items-center justify-center py-12 text-center" role="status">
                  <p className="text-sm text-[var(--text-muted)]">
                    {items.length === 0 ? "Пока нет сгенерированных резюме." : "Ничего не найдено по фильтрам."}
                  </p>
                </div>
              </li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
