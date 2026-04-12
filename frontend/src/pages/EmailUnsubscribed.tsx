import { Link, useSearchParams } from "react-router-dom";
import { t } from "../i18n";

export default function EmailUnsubscribed() {
  const [params] = useSearchParams();
  const ok = params.get("ok") === "1";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F2F3F9] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#EBEDF5] bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-[#181819]">
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
