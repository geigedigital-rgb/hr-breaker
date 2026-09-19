import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { t, tFormat } from "../../i18n";

export function NextStepCard({
  improvementCount,
  primaryLabel,
  canPrimary,
  loading,
  onPrimary,
  onReviewOneByOne,
  secondaryLabel,
  onSecondary,
}: {
  improvementCount: number;
  primaryLabel: string;
  canPrimary: boolean;
  loading?: boolean;
  onPrimary: () => void;
  onReviewOneByOne: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const headline =
    improvementCount > 0
      ? tFormat(t("optimize.workspace.improvementsFound"), { count: improvementCount })
      : t("optimize.workspace.lookingGood");

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-[0_8px_28px_rgba(69,120,252,0.35)]"
      style={{
        background: "linear-gradient(135deg, #3B82F6 0%, #6366F1 45%, #14B8A6 100%)",
      }}
    >
      <div className="pointer-events-none absolute -right-4 -top-2 opacity-25" aria-hidden>
        <div className="h-24 w-20 rotate-12 rounded-lg border-2 border-white/60 bg-white/10" />
        <div className="absolute left-6 top-6 h-24 w-20 -rotate-6 rounded-lg border-2 border-white/40 bg-white/5" />
      </div>
      <p className="relative text-[11px] font-bold uppercase tracking-[0.14em] text-white/80">
        {t("optimize.workspace.nextStep")}
      </p>
      <p className="relative mt-2 text-[22px] font-bold leading-tight tracking-tight">{headline}</p>
      <button
        type="button"
        disabled={!canPrimary || loading}
        onClick={onPrimary}
        className={`optimize-ws-improve-cta relative mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-[15px] font-semibold text-[#1E3A8A] shadow-sm transition hover:bg-white/95 disabled:cursor-not-allowed disabled:opacity-50 ${
          !loading && canPrimary ? "optimize-ws-improve-cta--live" : ""
        }`}
      >
        <span className="relative z-[1] inline-flex items-center gap-2">
          {loading ? t("optimize.improving") : primaryLabel}
          <ArrowRightIcon className="h-4 w-4" />
        </span>
      </button>
      <button
        type="button"
        onClick={onReviewOneByOne}
        className="relative mt-3 text-[13px] font-medium text-white/90 underline-offset-2 hover:underline"
      >
        {t("optimize.workspace.reviewOneByOne")} →
      </button>
      {secondaryLabel && onSecondary && (
        <button
          type="button"
          onClick={onSecondary}
          className="relative mt-2 block text-[12px] font-medium text-white/75 hover:text-white"
        >
          {secondaryLabel}
        </button>
      )}
    </div>
  );
}
