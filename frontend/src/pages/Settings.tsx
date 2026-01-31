import { useEffect, useState } from "react";
import * as api from "../api";

export default function Settings() {
  const [settings, setSettings] = useState<api.SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (!settings) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
        <span className="inline-block w-4 h-4 border-2 border-[#4578FC] border-t-transparent rounded-full animate-spin" />
        Загрузка…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#181819] tracking-tight">Настройки</h1>

      <div className="rounded-2xl bg-[#FFFFFF] p-6 max-w-xl space-y-6">
        <div>
          <label className="block text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
            API ключ
          </label>
          <p className="text-sm text-gray-700">
            {settings.has_api_key ? (
              <span className="text-green-600 font-medium">Задан (GOOGLE_API_KEY)</span>
            ) : (
              <span className="text-amber-600 font-medium">Не задан. Укажите GOOGLE_API_KEY в окружении.</span>
            )}
          </p>
        </div>
        <div>
          <label className="block text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
            Макс. итераций
          </label>
          <p className="text-sm text-gray-700">{settings.max_iterations}</p>
        </div>
        <div>
          <label className="block text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
            Папка вывода
          </label>
          <p className="text-sm text-gray-600 font-mono break-all">{settings.output_dir}</p>
        </div>
      </div>
    </div>
  );
}
