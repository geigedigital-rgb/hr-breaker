import { useState, useEffect } from "react";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { SparklesIcon } from "@heroicons/react/24/outline";
import * as api from "../api";

type Stage = "idle" | "scanning" | "assessment" | "loading" | "result";

function getAtsScore(result: api.OptimizeResponse): number | null {
  const r = result.validation.results.find((f) => f.filter_name === "LLMChecker");
  return r != null ? Math.round(r.score * 100) : null;
}

function getKeywordsScore(result: api.OptimizeResponse): { score: number; threshold: number } | null {
  const r = result.validation.results.find((f) => f.filter_name === "KeywordMatcher");
  return r != null ? { score: r.score, threshold: r.threshold } : null;
}

export default function Optimize() {
  const [resumeContent, setResumeContent] = useState("");
  const [resumeName, setResumeName] = useState<{ first?: string; last?: string } | null>(null);
  const [jobInput, setJobInput] = useState("");
  const [jobMode, setJobMode] = useState<"url" | "text">("url");
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<api.OptimizeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasResume = !!resumeContent.trim();
  const hasJob = !!jobInput.trim();
  const canImprove = hasResume && hasJob && stage === "assessment" && result === null;

  // Сброс при неполных данных
  useEffect(() => {
    if (!hasResume || !hasJob) setStage("idle");
  }, [hasResume, hasJob]);

  // После заполнения резюме и вакансии — этап «Сканирование», затем «Оценка» (только из idle)
  useEffect(() => {
    if (!hasResume || !hasJob || stage !== "idle") return;
    setStage("scanning");
    const t = setTimeout(() => setStage("assessment"), 1800);
    return () => clearTimeout(t);
  }, [hasResume, hasJob, stage]);

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
    setStage("scanning");
    try {
      await api.parseJob({ url: jobInput.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch job");
    } finally {
      setStage("assessment");
    }
  }

  async function handleImprove() {
    if (!canImprove) return;
    setError(null);
    setStage("loading");
    try {
      const res = await api.optimize({
        resume_content: resumeContent.trim(),
        job_text: jobMode === "text" ? jobInput.trim() : undefined,
        job_url: jobMode === "url" ? jobInput.trim() : undefined,
        parallel: true,
      });
      setResult(res);
      setStage("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed");
      setStage("assessment");
    }
  }

  const atsValue = result ? getAtsScore(result) : null;
  const keywordsValue = result ? getKeywordsScore(result) : null;

  return (
    <div className="flex gap-6 h-full min-h-0">
      {/* Левая колонка: один блок с шагами */}
      <div className="w-[420px] shrink-0 flex flex-col gap-6 overflow-auto">
        {error && (
          <div className="rounded-xl bg-red-50 text-red-800 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="rounded-2xl bg-[#FFFFFF] p-6 border border-[#EBEDF5]">
          {/* Один слот: показывается либо Шаг 1, либо Шаг 2 */}
          {!hasResume ? (
            /* Шаг 1 — на месте слота */
            <div>
              <div className="inline-flex items-center rounded-lg border border-[#4578FC]/25 bg-[#4578FC]/08 px-2.5 py-1 mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4578FC]">Шаг 1</span>
              </div>
              <h2 className="text-base font-semibold text-[#181819] mb-4">Загрузите резюме</h2>
              <div className="flex gap-2 mb-3">
                <button type="button" className="px-3 py-2 text-sm font-medium rounded-xl bg-[#EBEDF5] text-gray-700 hover:bg-gray-100 transition-colors">
                  Загрузить файл
                </button>
                <button type="button" className="px-3 py-2 text-sm font-medium rounded-xl bg-[#EBEDF5] text-gray-700 hover:bg-gray-100 transition-colors">
                  Вставить текст
                </button>
              </div>
              <textarea
                value={resumeContent}
                onChange={(e) => setResumeContent(e.target.value)}
                onBlur={handleResumePaste}
                placeholder="Вставьте текст резюме…"
                className="w-full h-28 rounded-xl bg-[#EBEDF5] px-4 py-3 text-sm text-[#181819] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:bg-[#FFFFFF] resize-none transition-colors"
              />
            </div>
          ) : (
            /* Шаг 2 — на месте шага 1 после заполнения резюме */
            <div>
              <div className="inline-flex items-center rounded-lg border border-[#4578FC]/25 bg-[#4578FC]/08 px-2.5 py-1 mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4578FC]">Шаг 2</span>
              </div>
              <h2 className="text-base font-semibold text-[#181819] mb-2">Загрузите вакансию</h2>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Резюме: {resumeName ? `${resumeName.first ?? ""} ${resumeName.last ?? ""}`.trim() || "Загружено" : "Загружено"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setResumeContent("");
                    setResumeName(null);
                    setResult(null);
                    setStage("idle");
                  }}
                  className="text-[#4578FC] hover:opacity-80 font-medium"
                >
                  Изменить
                </button>
              </p>
              {hasJob ? (
                <>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="text-sm font-medium text-[#181819] truncate max-w-[220px]">
                      {jobInput.slice(0, 45)}…
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setJobInput("");
                        setResult(null);
                        setStage("idle");
                      }}
                      className="shrink-0 text-sm font-medium text-[#4578FC] hover:opacity-80"
                    >
                      Изменить
                    </button>
                  </div>
                  <Disclosure>
                    <DisclosureButton className="text-sm text-[var(--text-muted)] hover:text-[#181819]">
                      Предпросмотр
                    </DisclosureButton>
                    <DisclosurePanel className="mt-2 text-sm text-gray-600 whitespace-pre-wrap max-h-28 overflow-y-auto">
                      {jobInput.slice(0, 400)}…
                    </DisclosurePanel>
                  </Disclosure>
                </>
              ) : (
                <>
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setJobMode("url")}
                      className={`px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
                        jobMode === "url" ? "bg-[#4578FC] text-white" : "bg-[#EBEDF5] text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      URL
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobMode("text")}
                      className={`px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
                        jobMode === "text" ? "bg-[#4578FC] text-white" : "bg-[#EBEDF5] text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      Вставить текст
                    </button>
                  </div>
                  <textarea
                    value={jobInput}
                    onChange={(e) => setJobInput(e.target.value)}
                    placeholder={jobMode === "url" ? "https://…" : "Вставьте описание вакансии…"}
                    className="w-full h-28 rounded-xl bg-[#EBEDF5] px-4 py-3 text-sm text-[#181819] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:bg-[#FFFFFF] resize-none transition-colors"
                  />
                  {jobMode === "url" && (
                    <button
                      type="button"
                      onClick={handleJobFetch}
                      disabled={stage === "scanning"}
                      className="mt-3 text-sm font-medium text-[#4578FC] hover:opacity-80 disabled:opacity-50"
                    >
                      Загрузить по URL
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Правая колонка: оценка + кнопка + результат */}
      <div className="flex-1 min-w-0 flex flex-col gap-5 overflow-auto">
        {stage === "idle" && !hasResume && (
          <div className="rounded-2xl bg-[#FFFFFF] p-8 text-center text-[var(--text-muted)] text-sm">
            Загрузите резюме и вакансию слева, чтобы увидеть оценку соответствия.
          </div>
        )}

        {(stage === "scanning" || stage === "assessment" || stage === "result") && hasResume && hasJob && (
          <>
            {stage === "scanning" && (
              <div className="rounded-2xl bg-[#FFFFFF] p-8 flex flex-col items-center justify-center gap-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse"
                  style={{ background: "linear-gradient(135deg, #EAFCB6 0%, #b0d8ff 50%, #4578FC 100%)" }}
                >
                  <SparklesIcon className="w-7 h-7 text-[#181819]" />
                </div>
                <p className="text-[#181819] font-medium">Сканирование…</p>
                <p className="text-sm text-[var(--text-muted)]">Анализируем резюме и вакансию</p>
              </div>
            )}

            {(stage === "assessment" || stage === "result") && (
              <>
                {/* Карточка ATS match */}
                <div className="rounded-2xl bg-[#FFFFFF] p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-[#4578FC] bg-[#EBEDF5]">
                      {result && atsValue != null ? `${atsValue}%` : "—"}
                    </div>
                    <div>
                      <p className="font-semibold text-[#181819]">ATS match</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {result ? (result.validation.passed ? "Резюме проходит автоматический отбор." : "Есть что улучшить.") : "Соответствие резюме вакансии."}
                      </p>
                    </div>
                  </div>
                  {stage === "assessment" && (
                    <button
                      type="button"
                      disabled
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-[#EBEDF5] text-[var(--text-muted)] cursor-default"
                    >
                      <SparklesIcon className="w-4 h-4" />
                      Улучшить с AI
                    </button>
                  )}
                </div>

                {/* Карточка Key words */}
                <div className="rounded-2xl bg-[#FFFFFF] p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-sm font-bold text-[#4578FC] bg-[#EBEDF5]">
                      {result && keywordsValue != null
                        ? `${Math.round(keywordsValue.score * 100)}%`
                        : "—"}
                    </div>
                    <div>
                      <p className="font-semibold text-[#181819]">Ключевые слова</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {result ? "Покрытие ключевых слов из вакансии." : "Шанс попасть в топ-10 кандидатов."}
                      </p>
                    </div>
                  </div>
                  {stage === "assessment" && (
                    <button
                      type="button"
                      disabled
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-[#EBEDF5] text-[var(--text-muted)] cursor-default"
                    >
                      <SparklesIcon className="w-4 h-4" />
                      Улучшить с AI
                    </button>
                  )}
                </div>

                {/* Кнопка «Улучшить» — одна на блок */}
                {stage === "assessment" && (
                  <button
                    type="button"
                    onClick={handleImprove}
                    disabled={!canImprove}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl text-sm font-medium text-[#181819] whitespace-nowrap transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: "linear-gradient(128deg, #EAFCB6 0%, #d4f090 18%, #b0d8ff 52%, #5e8afc 88%, #4578FC 100%)",
                    }}
                  >
                    <SparklesIcon className="w-5 h-5 shrink-0" />
                    Улучшить резюме
                  </button>
                )}

                {/* Результат после улучшения */}
                {stage === "result" && result && (
                  <div className="rounded-2xl bg-[#FFFFFF] p-6 space-y-5">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Результат
                    </h2>
                    <p className="text-base font-medium text-green-600">
                      Готово. {atsValue != null && `ATS match: ${atsValue}%. `}
                      {keywordsValue != null && `Ключевые слова: ${Math.round(keywordsValue.score * 100)}%.`}
                    </p>
                    {result.pdf_filename && result.pdf_base64 && (
                      <a
                        href={`data:application/pdf;base64,${result.pdf_base64}`}
                        download={result.pdf_filename}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#4578FC] text-white text-sm font-medium hover:bg-[#3a6ae8] transition-colors"
                      >
                        Скачать PDF
                      </a>
                    )}
                    {result.error && <p className="text-sm text-red-600">{result.error}</p>}
                    <Disclosure>
                      <DisclosureButton className="text-sm font-medium text-[var(--text-muted)] hover:text-[#181819]">
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
                          </div>
                        ))}
                      </DisclosurePanel>
                    </Disclosure>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Лоадер на весь экран при загрузке */}
        {stage === "loading" && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#EBEDF5]/95 backdrop-blur-sm">
            <div
              className="relative w-24 h-24 rounded-3xl flex items-center justify-center animate-pulse"
              style={{
                background: "linear-gradient(135deg, #EAFCB6 0%, #b0d8ff 50%, #4578FC 100%)",
                boxShadow: "0 0 60px rgba(69, 120, 252, 0.4), 0 0 100px rgba(234, 252, 182, 0.2)",
              }}
            >
              <SparklesIcon className="w-12 h-12 text-[#181819]" />
            </div>
            <p className="text-[#181819] font-semibold text-lg">Улучшаем резюме…</p>
            <p className="text-sm text-[var(--text-muted)]">Не закрывайте страницу</p>
          </div>
        )}
      </div>
    </div>
  );
}
