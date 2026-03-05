import { useEffect, useState } from "react";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";

export default function Settings() {
  const { user, loading: authLoading, logout } = useAuth();
  const [settings, setSettings] = useState<api.SettingsResponse | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setSettingsError(e instanceof Error ? e.message : "Не удалось загрузить статус сервиса"));
  }, []);

  const loading = authLoading && !user && !settings;

  if (loading) {
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

      <div className="grid gap-6 max-w-3xl md:grid-cols-2">
        {/* Аккаунт */}
        <section className="rounded-2xl bg-[#FFFFFF] p-6 space-y-4">
          <h2 className="text-base font-semibold text-[#181819]">Аккаунт</h2>
          {user && user.id !== "local" ? (
            <>
              <div>
                <p className="text-sm font-medium text-[#181819]">
                  {user.name || user.email.split("@")[0]}
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#EBEDF5] text-sm font-medium text-[#181819] hover:bg-[#E0E4EE] transition-colors"
              >
                Выйти из аккаунта
              </button>
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Вы используете локальный режим без аккаунта. Войдите или зарегистрируйтесь, чтобы сохранять историю
              улучшений между устройствами.
            </p>
          )}
        </section>

        {/* Данные и приватность */}
        <section className="rounded-2xl bg-[#FFFFFF] p-6 space-y-3">
          <h2 className="text-base font-semibold text-[#181819]">Резюме и данные</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Загруженные резюме и сгенерированные PDF видны только вам. Вы можете удалить любой файл в разделах
            «Мои резюме» и «История улучшений».
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            Удаление файла в истории полностью убирает его из списка и делает недоступным для скачивания.
          </p>
        </section>

        {/* Статус сервиса */}
        <section className="rounded-2xl bg-[#FFFFFF] p-6 space-y-3 md:col-span-2">
          <h2 className="text-base font-semibold text-[#181819]">Статус сервиса</h2>
          {settingsError && (
            <p className="text-sm text-red-600" role="alert">
              {settingsError}
            </p>
          )}
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-muted)]">Оптимизация резюме</span>
              <span className="text-right font-medium">
                {settings?.has_api_key ? (
                  <span className="text-green-600">Доступна</span>
                ) : (
                  <span className="text-amber-600">Временно недоступна</span>
                )}
              </span>
            </li>
            {typeof settings?.max_iterations === "number" && (
              <li className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-muted)]">Глубина улучшения за один запуск</span>
                <span className="text-right text-[#181819]">
                  до {settings.max_iterations} итераций оптимизации
                </span>
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
