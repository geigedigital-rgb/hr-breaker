import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MapPinIcon,
  BriefcaseIcon,
  CalendarIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";
import * as api from "../api";
import { t } from "../i18n";

const POPULAR_QUERIES = [
  "Python Developer",
  "Backend",
  "Data Analyst",
  "Frontend",
  "DevOps",
  "Product Manager",
];

function formatPosted(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} wk ago`;
  return `${Math.floor(diffDays / 30)} mo ago`;
}

export default function Vacancies() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [fullTime, setFullTime] = useState<boolean | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [salaryMin, setSalaryMin] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.VacancySearchResponse | null>(null);

  const search = useCallback(
    async (query: string, pageNum: number = 1) => {
      const queryTrim = query.trim();
      if (!queryTrim) return;
      setLoading(true);
      setError(null);
      try {
        const res = await api.searchVacancies({
          q: queryTrim,
          location: location.trim() || undefined,
          full_time: fullTime ?? undefined,
          permanent: permanent || undefined,
          salary_min: salaryMin ? parseInt(salaryMin, 10) : undefined,
          page: pageNum,
          page_size: 20,
        });
        setResult(res);
        setPage(pageNum);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("vacancies.loadError"));
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [location, fullTime, permanent, salaryMin]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(q, 1);
  };

  const handleBadge = (query: string) => {
    setQ(query);
    search(query, 1);
  };

  const pageSize = result?.page_size ?? 20;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 0;

  return (
    <div className="min-h-full bg-[#F2F3F9]">
      <div className="max-w-3xl mx-auto p-4 lg:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-sm text-[var(--text-muted)] hover:text-[#181819] transition-colors"
          >
            ← Главная
          </Link>
        </div>

        <section className="rounded-2xl border border-[#EBEDF5] bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-[#181819] mb-4">Найти вакансию</h1>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Поиск по объявлениям в Германии (Adzuna)
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Должность или ключевые слова"
                className="flex-1 min-w-[200px] h-11 rounded-xl border border-[#EBEDF5] bg-[#FAFAFC] px-4 text-sm text-[#181819] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/25 focus:border-[#4578FC]/40"
                aria-label="Поиск вакансий"
              />
              <button
                type="submit"
                disabled={loading || !q.trim()}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#4578FC] text-white text-sm font-semibold hover:bg-[#3d6ae6] disabled:opacity-50 disabled:pointer-events-none transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-2"
              >
                <MagnifyingGlassIcon className="w-4 h-4" />
                Найти
              </button>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setFiltersOpen((o) => !o)}
                className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[#181819] transition-colors"
              >
                {filtersOpen ? (
                  <ChevronUpIcon className="w-4 h-4" />
                ) : (
                  <ChevronDownIcon className="w-4 h-4" />
                )}
                Фильтры
              </button>
              {filtersOpen && (
                <div className="mt-3 p-4 rounded-xl bg-[#FAFAFC] border border-[#EBEDF5] space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      Город / регион
                    </label>
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Например Berlin"
                      className="w-full max-w-xs h-9 rounded-lg border border-[#EBEDF5] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4578FC]/25"
                    />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm text-[#181819]">
                      <input
                        type="checkbox"
                        checked={fullTime === true}
                        onChange={(e) => setFullTime(e.target.checked ? true : null)}
                        className="rounded border-[#EBEDF5] text-[#4578FC] focus:ring-[#4578FC]/30"
                      />
                      Full-time
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[#181819]">
                      <input
                        type="checkbox"
                        checked={permanent}
                        onChange={(e) => setPermanent(e.target.checked)}
                        className="rounded border-[#EBEDF5] text-[#4578FC] focus:ring-[#4578FC]/30"
                      />
                      Постоянный контракт
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      Зарплата от (€)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={salaryMin}
                      onChange={(e) => setSalaryMin(e.target.value)}
                      placeholder="50000"
                      className="w-32 h-9 rounded-lg border border-[#EBEDF5] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4578FC]/25"
                    />
                  </div>
                </div>
              )}
            </div>
          </form>

          <div className="mt-4">
            <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Популярные запросы</p>
            <div className="flex flex-wrap gap-2">
              {POPULAR_QUERIES.map((query) => (
                <button
                  key={query}
                  type="button"
                  onClick={() => handleBadge(query)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-[#EBEDF5] text-[#181819] hover:bg-[#E0E4EE] transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/20"
                >
                  {query}
                </button>
              ))}
            </div>
          </div>
        </section>

        {error && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </div>
        )}

        {loading && (
          <div className="rounded-2xl border border-[#EBEDF5] bg-white p-6 flex flex-col items-center justify-center gap-3">
            <span className="inline-block w-8 h-8 border-2 border-[#4578FC] border-t-transparent rounded-full animate-spin" aria-hidden />
            <p className="text-sm text-[var(--text-muted)]">Загрузка вакансий…</p>
          </div>
        )}

        {!loading && result && (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              Найдено: {result.total}. Страница {result.page} из {totalPages}.
            </p>
            {result.items.length === 0 ? (
              <div className="rounded-2xl border border-[#EBEDF5] bg-white p-8 text-center">
                <p className="text-[#181819] font-medium">По запросу ничего не найдено</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">Измените параметры или попробуйте другие слова</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {result.items.map((card) => (
                  <li
                    key={card.id}
                    className="rounded-2xl border border-[#EBEDF5] bg-white p-4 shadow-sm hover:border-[#c8cddc] transition-colors"
                  >
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-base font-semibold text-[#181819] group-hover:text-[#4578FC] transition-colors line-clamp-2">
                          {card.title}
                        </h2>
                        <ArrowTopRightOnSquareIcon className="w-4 h-4 shrink-0 text-[var(--text-muted)] group-hover:text-[#4578FC]" />
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
                        <BriefcaseIcon className="w-4 h-4 shrink-0" />
                        {card.company}
                      </p>
                      {card.location && (
                        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
                          <MapPinIcon className="w-4 h-4 shrink-0" />
                          {card.location}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                        {card.salary_text && (
                          <span className="font-medium text-[#181819]">{card.salary_text}</span>
                        )}
                        {card.contract_type && (
                          <span>{card.contract_type}</span>
                        )}
                        {card.posted_at && (
                          <span className="flex items-center gap-0.5">
                            <CalendarIcon className="w-3.5 h-3.5" />
                            {formatPosted(card.posted_at)}
                          </span>
                        )}
                      </div>
                      {card.snippet && (
                        <p className="mt-2 text-sm text-[var(--text-muted)] line-clamp-2">
                          {card.snippet}
                        </p>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {result.items.length > 0 && totalPages > 1 && (
              <div className="flex flex-wrap items-center gap-2 pt-4">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => search(q, page - 1)}
                  className="px-4 py-2 rounded-xl border border-[#EBEDF5] bg-white text-sm font-medium text-[#181819] hover:bg-[#FAFAFC] disabled:opacity-50 disabled:pointer-events-none"
                >
                  Назад
                </button>
                <span className="text-sm text-[var(--text-muted)]">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => search(q, page + 1)}
                  className="px-4 py-2 rounded-xl border border-[#EBEDF5] bg-white text-sm font-medium text-[#181819] hover:bg-[#FAFAFC] disabled:opacity-50 disabled:pointer-events-none"
                >
                  Вперёд
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
