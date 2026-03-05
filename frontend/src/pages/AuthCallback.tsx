import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../api";
import { setStoredToken } from "../api";

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const code = searchParams.get("code");

  useEffect(() => {
    if (!code) {
      setError("Нет кода от Google");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.exchangeGoogleCode(code);
        if (cancelled) return;
        setStoredToken(res.access_token);
        navigate("/", { replace: true });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Ошибка входа через Google");
      }
    })();
    return () => { cancelled = true; };
  }, [code, navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl border border-[#EBEDF5] bg-white p-8 text-center">
        <p className="text-red-600">{error}</p>
        <a href="/login" className="mt-4 inline-block text-[#4578FC] hover:underline">
          Вернуться на страницу входа
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
        <p className="mt-3 text-sm text-[var(--text-muted)]">Вход через Google…</p>
      </div>
    </div>
  );
}
