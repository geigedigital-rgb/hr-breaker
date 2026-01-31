import { useState } from "react";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import * as api from "../api";

export default function Optimize() {
  const [resumeContent, setResumeContent] = useState("");
  const [resumeName, setResumeName] = useState<{ first?: string; last?: string } | null>(null);
  const [jobInput, setJobInput] = useState("");
  const [jobMode, setJobMode] = useState<"url" | "text">("url");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<api.OptimizeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasResume = !!resumeContent.trim();
  const hasJob = !!jobInput.trim();
  const canOptimize = hasResume && hasJob && !loading;

  async function handleResumePaste() {
    if (!resumeContent.trim()) return;
    setError(null);
    try {
      const r = await api.extractName(resumeContent);
      setResumeName({ first: r.first_name ?? undefined, last: r.last_name ?? undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to extract name");
    }
  }

  async function handleJobFetch() {
    if (!jobInput.trim() || jobMode !== "url") return;
    setError(null);
    setLoading(true);
    try {
      await api.parseJob({ url: jobInput.trim() });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch job");
    } finally {
      setLoading(false);
    }
  }

  async function handleOptimize() {
    if (!canOptimize) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await api.optimize({
        resume_content: resumeContent.trim(),
        job_text: jobMode === "text" ? jobInput.trim() : undefined,
        job_url: jobMode === "url" ? jobInput.trim() : undefined,
        parallel: true,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Заголовок страницы */}
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Оптимизация резюме</h1>
        <button
          type="button"
          onClick={handleOptimize}
          disabled={!canOptimize}
          className="shrink-0 px-5 py-2.5 rounded-xl bg-[#2E9FFF] text-white text-sm font-medium hover:bg-[#2590e6] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Оптимизация…" : "Оптимизировать резюме"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 text-red-800 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Карточки без бордеров и тени */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl bg-[#FFFFFF] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">
            Резюме
          </h2>
          {hasResume ? (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <span className="text-base font-medium text-gray-900 truncate">
                  {resumeName ? `${resumeName.first ?? ""} ${resumeName.last ?? ""}`.trim() || "Загружено" : "Загружено"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setResumeContent("");
                    setResumeName(null);
                    setResult(null);
                  }}
                  className="shrink-0 text-sm font-medium text-[#2E9FFF] hover:opacity-80"
                >
                  Изменить
                </button>
              </div>
              <Disclosure>
                <DisclosureButton className="text-sm text-[var(--text-muted)] hover:text-gray-900">
                  Предпросмотр
                </DisclosureButton>
                <DisclosurePanel className="mt-2 text-sm text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                  {resumeContent.slice(0, 500)}…
                </DisclosurePanel>
              </Disclosure>
            </>
          ) : (
            <>
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  className="px-3 py-2 text-sm font-medium rounded-xl bg-[#F9F9F9] text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  Загрузить файл
                </button>
                <button
                  type="button"
                  className="px-3 py-2 text-sm font-medium rounded-xl bg-[#F9F9F9] text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  Вставить текст
                </button>
              </div>
              <textarea
                value={resumeContent}
                onChange={(e) => setResumeContent(e.target.value)}
                onBlur={handleResumePaste}
                placeholder="Вставьте текст резюме…"
                className="w-full h-36 rounded-xl bg-[#F9F9F9] px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2E9FFF]/30 focus:bg-[#FFFFFF] resize-none transition-colors"
              />
            </>
          )}
        </div>

        <div className="rounded-2xl bg-[#FFFFFF] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">
            Вакансия
          </h2>
          {hasJob ? (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <span className="text-base font-medium text-gray-900 truncate max-w-[220px]">
                  {jobInput.slice(0, 45)}…
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setJobInput("");
                    setResult(null);
                  }}
                  className="shrink-0 text-sm font-medium text-[#2E9FFF] hover:opacity-80"
                >
                  Изменить
                </button>
              </div>
              <Disclosure>
                <DisclosureButton className="text-sm text-[var(--text-muted)] hover:text-gray-900">
                  Предпросмотр
                </DisclosureButton>
                <DisclosurePanel className="mt-2 text-sm text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                  {jobInput.slice(0, 500)}…
                </DisclosurePanel>
              </Disclosure>
            </>
          ) : (
            <>
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setJobMode("url")}
                  className={`px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
                    jobMode === "url" ? "bg-[#2E9FFF] text-white" : "bg-[#F9F9F9] text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  URL
                </button>
                <button
                  type="button"
                  onClick={() => setJobMode("text")}
                  className={`px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
                    jobMode === "text" ? "bg-[#2E9FFF] text-white" : "bg-[#F9F9F9] text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  Вставить текст
                </button>
              </div>
              <textarea
                value={jobInput}
                onChange={(e) => setJobInput(e.target.value)}
                placeholder={jobMode === "url" ? "https://…" : "Вставьте описание вакансии…"}
                className="w-full h-36 rounded-xl bg-[#F9F9F9] px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2E9FFF]/30 focus:bg-[#FFFFFF] resize-none transition-colors"
              />
              {jobMode === "url" && (
                <button
                  type="button"
                  onClick={handleJobFetch}
                  disabled={loading}
                  className="mt-3 text-sm font-medium text-[#2E9FFF] hover:opacity-80 disabled:opacity-50"
                >
                  Загрузить по URL
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Блок результата — без бордера и тени */}
      {result && (
        <div className="rounded-2xl bg-[#FFFFFF] p-6 space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Результат
          </h2>
          <p className={`text-base font-medium ${result.validation.passed ? "text-green-600" : "text-amber-600"}`}>
            {result.validation.passed ? "Все проверки пройдены." : "Часть проверок не пройдена."}
          </p>
          {result.pdf_filename && result.pdf_base64 && (
            <a
              href={`data:application/pdf;base64,${result.pdf_base64}`}
              download={result.pdf_filename}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2E9FFF] text-white text-sm font-medium hover:bg-[#2590e6] transition-colors"
            >
              Скачать PDF
            </a>
          )}
          {result.error && (
            <p className="text-sm text-red-600">{result.error}</p>
          )}
          <Disclosure>
            <DisclosureButton className="text-sm font-medium text-[var(--text-muted)] hover:text-gray-900">
              Детали проверок
            </DisclosureButton>
            <DisclosurePanel className="mt-3 space-y-3">
              {result.validation.results.map((r) => (
                <div key={r.filter_name} className="text-sm">
                  <span className={r.passed ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                    {r.passed ? "✓" : "✗"} {r.filter_name}
                  </span>
                  <span className="text-[var(--text-muted)] ml-2">
                    {r.score.toFixed(2)} / {r.threshold.toFixed(2)}
                  </span>
                  {r.issues.length > 0 && (
                    <ul className="mt-1.5 pl-4 space-y-0.5 text-gray-600 list-disc">
                      {r.issues.map((i, k) => (
                        <li key={k}>{i}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </DisclosurePanel>
          </Disclosure>
        </div>
      )}
    </div>
  );
}
