import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";

export default function Upgrade() {
  const { user, loading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadingTrial, setLoadingTrial] = useState(false);
  const [loadingMonthly, setLoadingMonthly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const success = searchParams.get("success");
    const cancel = searchParams.get("cancel");
    if (success === "1" || cancel === "1") {
      void refreshUser();
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, refreshUser]);

  const plan = user?.subscription?.plan ?? "free";
  const status = user?.subscription?.status ?? "free";
  const periodEnd = user?.subscription?.current_period_end ?? null;
  const hasPaidPlan = plan === "trial" || plan === "monthly" || status === "active";

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const successUrl = `${baseUrl}/upgrade?success=1`;
  const cancelUrl = `${baseUrl}/upgrade?cancel=1`;

  const startCheckout = async (priceKey: "trial" | "monthly") => {
    if (!user) {
      navigate("/login");
      return;
    }
    setError(null);
    if (priceKey === "trial") setLoadingTrial(true);
    else setLoadingMonthly(true);
    try {
      const { url } = await api.createCheckoutSession({
        price_key: priceKey,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (url) window.location.href = url;
      else setError("Не удалось получить ссылку на оплату");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка при создании сессии оплаты");
    } finally {
      setLoadingTrial(false);
      setLoadingMonthly(false);
    }
  };

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
          <h1 className="text-xl font-semibold text-[#181819] tracking-tight">Upgrade</h1>
        </div>

        {hasPaidPlan && (
          <section className="rounded-2xl border border-green-200 bg-green-50/80 p-4 text-sm text-[#181819]">
            <strong>Текущий план:</strong>{" "}
            {plan === "trial" ? "Trial 7 дней" : plan === "monthly" ? "Monthly" : status}
            {periodEnd && (
              <span className="text-[var(--text-muted)]"> · Активен до {new Date(periodEnd).toLocaleDateString()}</span>
            )}
          </section>
        )}

        {error && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </section>
        )}

        <section className="rounded-2xl border border-[#EBEDF5] bg-white p-5 shadow-sm space-y-4">
          <p className="text-sm text-[var(--text-muted)]">
            Оплата и автопродление через Stripe. Честная Fair Usage Policy без «кредитов» и скрытых лимитов.
            Отменить подписку можно до списания следующего платежа.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {/* Free */}
          <div className="rounded-2xl border border-[#EBEDF5] bg-white p-5 flex flex-col">
            <h2 className="text-base font-semibold text-[#181819]">Free</h2>
            <p className="mt-1 text-2xl font-bold text-[#181819]">0&nbsp;$</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Для первого знакомства с сервисом</p>
            <ul className="mt-4 space-y-2 text-sm text-[#181819]">
              <li>• Оценка резюме (ATS score)</li>
              <li>• Краткий список проблем</li>
              <li>• Превью нескольких улучшенных блоков</li>
              <li className="text-[var(--text-muted)]">• Без экспорта PDF</li>
            </ul>
            <div className="mt-4 py-2 text-xs text-[var(--text-muted)]">
              {plan === "free" ? "Текущий план" : ""}
            </div>
          </div>

          {/* Trial */}
          <div className="rounded-2xl border-2 border-[#4578FC] bg-white p-5 flex flex-col relative">
            <div className="absolute -top-3 right-4 rounded-full bg-[#4578FC] px-3 py-0.5 text-[10px] font-semibold text-white uppercase tracking-wide">
              Рекомендуем
            </div>
            <h2 className="text-base font-semibold text-[#181819]">Trial 7 дней</h2>
            <p className="mt-1 text-2xl font-bold text-[#181819]">$2.99</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Полный доступ на 7 дней. Затем можно оформить месячную подписку.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-[#181819]">
              <li>• Полная оптимизация резюме</li>
              <li>• Tailoring под конкретные вакансии</li>
              <li>• Повторные правки и переформулировки</li>
              <li>• Экспорт PDF</li>
            </ul>
            {!user && !loading ? (
              <Link
                to="/login"
                className="mt-4 inline-flex items-center justify-center rounded-xl bg-[#4578FC] text-white text-sm font-semibold h-10 hover:opacity-90"
              >
                Войти для оформления
              </Link>
            ) : plan === "trial" || (plan === "monthly" && status === "active") ? (
              <div className="mt-4 py-2 text-xs text-[var(--text-muted)]">Текущий план</div>
            ) : (
              <button
                type="button"
                disabled={loadingTrial}
                onClick={() => startCheckout("trial")}
                className="mt-4 inline-flex items-center justify-center rounded-xl bg-[#4578FC] text-white text-sm font-semibold h-10 hover:opacity-90 disabled:opacity-60"
              >
                {loadingTrial ? "Переход на Stripe…" : "Оформить Trial"}
              </button>
            )}
          </div>

          {/* Monthly */}
          <div className="rounded-2xl border border-[#EBEDF5] bg-white p-5 flex flex-col">
            <h2 className="text-base font-semibold text-[#181819]">Monthly</h2>
            <p className="mt-1 text-2xl font-bold text-[#181819]">$29</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Для активного поиска работы 1–2 месяца</p>
            <ul className="mt-4 space-y-2 text-sm text-[#181819]">
              <li>• Полный функционал оптимизации</li>
              <li>• Tailoring под вакансии</li>
              <li>• Экспорт PDF без ограничений</li>
            </ul>
            {!user && !loading ? (
              <Link
                to="/login"
                className="mt-4 inline-flex items-center justify-center rounded-xl border border-[#EBEDF5] text-sm font-semibold h-10 text-[#181819] hover:bg-[#F2F3F9]"
              >
                Войти для оформления
              </Link>
            ) : plan === "monthly" && status === "active" ? (
              <div className="mt-4 py-2 text-xs text-[var(--text-muted)]">Текущий план</div>
            ) : (
              <button
                type="button"
                disabled={loadingMonthly}
                onClick={() => startCheckout("monthly")}
                className="mt-4 inline-flex items-center justify-center rounded-xl border border-[#EBEDF5] text-sm font-semibold h-10 text-[#181819] hover:bg-[#F2F3F9] disabled:opacity-60"
              >
                {loadingMonthly ? "Переход на Stripe…" : "Подписаться"}
              </button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[#EBEDF5] bg-white p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#181819]">Как это работает</h2>
          <ul className="text-sm text-[var(--text-muted)] space-y-1">
            <li>• Оплата и автопродление через Stripe.</li>
            <li>• Отменить подписку можно в любой момент до следующего списания.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
