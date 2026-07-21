import { Link, useSearchParams } from "react-router-dom";
import { t } from "../i18n";

export default function EmailUnsubscribed() {
  const [params] = useSearchParams();
  const ok = params.get("ok") === "1";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-page)] px-4">
      <div className="w-full max-w-md ds-card p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-[var(--text)]">
          {ok ? t("emailUnsubscribed.titleOk") : t("emailUnsubscribed.titleErr")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
          {ok ? t("emailUnsubscribed.bodyOk") : t("emailUnsubscribed.bodyErr")}
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex text-sm font-medium text-[#1D4ED8] hover:underline"
        >
          {t("emailUnsubscribed.backHome")}
        </Link>
      </div>
    </div>
  );
}
