import { useEffect, useState } from "react";
import * as api from "../api";

export default function History() {
  const [items, setItems] = useState<api.HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getHistory()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
        <span className="inline-block w-4 h-4 border-2 border-[#4578FC] border-t-transparent rounded-full animate-spin" />
        Загрузка…
      </div>
    );
  }
  if (error) {
    return <p className="text-red-600 text-sm">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#181819] tracking-tight">История</h1>
      <p className="text-sm text-[var(--text-muted)]">Ваши сгенерированные резюме</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((item) => (
          <div
            key={item.filename}
            className="rounded-2xl bg-[#FFFFFF] p-5 flex flex-col min-h-[140px]"
          >
            <div className="font-semibold text-[#181819] truncate text-base" title={item.job_title}>
              {item.job_title}
            </div>
            <div className="text-sm text-[var(--text-muted)] mt-1">{item.company}</div>
            <div className="text-xs text-[var(--text-muted)] mt-2 flex items-center gap-1.5">
              <span aria-hidden>📅</span>
              {new Date(item.timestamp).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </div>
            <div className="mt-auto pt-4 flex items-center gap-2">
              <a
                href={api.downloadUrl(item.filename)}
                download={item.filename}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#4578FC] text-white text-sm font-medium hover:bg-[#3a6ae8] transition-colors"
              >
                Скачать
              </a>
              <button
                type="button"
                className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-gray-700 transition-colors"
                title="Подробнее"
              >
                ⋯
              </button>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <p className="text-[var(--text-muted)] text-sm">Пока нет сгенерированных резюме.</p>
      )}
    </div>
  );
}
