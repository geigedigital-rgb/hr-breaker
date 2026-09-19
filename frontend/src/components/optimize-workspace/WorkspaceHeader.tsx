import {
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ShareIcon,
} from "@heroicons/react/24/outline";
import { t } from "../../i18n";

function MiniScoreRing({ pct, accent }: { pct: number; accent: string }) {
  const v = Math.max(0, Math.min(100, pct));
  const r = 9;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - v / 100);
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r={r} fill="none" stroke="#E2E8F0" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke={accent}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

export function WorkspaceHeader({
  brandName,
  profileLabel,
  userInitials,
  jobTitle,
  jobCompany,
  isImproveMode,
  matchPct,
  shareUrl,
  actionsEnabled,
  onExport,
  onShareFeedback,
}: {
  brandName: string;
  profileLabel: string;
  userInitials: string;
  jobTitle: string;
  jobCompany: string;
  isImproveMode: boolean;
  matchPct: number;
  shareUrl: string | null;
  /** Share / Export active only after improve (result stage). */
  actionsEnabled?: boolean;
  onExport: () => void;
  onShareFeedback: (msg: string) => void;
}) {
  const centerLabel = isImproveMode
    ? profileLabel || t("optimize.workspace.resumeUntitled")
    : [jobTitle, jobCompany].filter(Boolean).join(" — ") || "—";
  const centerInitial = isImproveMode
    ? (profileLabel || "?").trim().charAt(0).toUpperCase() || "?"
    : (jobCompany || jobTitle || "?").trim().charAt(0).toUpperCase() || "?";

  const canAct = Boolean(actionsEnabled);

  async function handleShare() {
    if (!canAct) {
      onShareFeedback(t("optimize.workspace.actionsLocked"));
      return;
    }
    if (!shareUrl) {
      onShareFeedback(t("optimize.workspace.shareUnavailable"));
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      onShareFeedback(t("optimize.workspace.shareCopied"));
    } catch {
      onShareFeedback(t("optimize.workspace.shareUnavailable"));
    }
  }

  function handleExport() {
    if (!canAct) {
      onShareFeedback(t("optimize.workspace.actionsLocked"));
      return;
    }
    onExport();
  }

  return (
    <header className="optimize-ws-header flex flex-wrap items-center gap-2 sm:gap-3 rounded-2xl border border-[#E8ECF4]/80 bg-white/55 px-3 py-2.5 backdrop-blur-md">
      <div className="flex items-center gap-2 shrink-0">
        <img src="/logo-color.svg" alt="" className="h-7 w-7 object-contain" />
        <span className="hidden sm:inline text-[14px] font-semibold tracking-tight text-[#0f172a]">
          {brandName}
        </span>
      </div>

      <div className="hidden md:flex items-center gap-1.5 rounded-full border border-[#E8ECF4] bg-[#F8FAFC] px-3 py-1.5 text-[12px] font-medium text-[#334155] max-w-[200px]">
        <span className="truncate">{profileLabel}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" aria-hidden />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#E8ECF4] bg-white px-2.5 py-1.5 shadow-sm">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[11px] font-bold text-[#4578FC]">
            {centerInitial}
          </span>
          <span className="truncate text-[12px] sm:text-[13px] font-semibold text-[#0f172a]">{centerLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#E8ECF4] bg-white px-2.5 py-1.5 text-[12px] font-semibold text-[#0f172a]">
          <MiniScoreRing pct={matchPct} accent={isImproveMode ? "#4578FC" : "#2DD4BF"} />
          {!isImproveMode && (
            <span className="text-[#64748B] font-medium">{t("optimize.workspace.match")}</span>
          )}
          {isImproveMode && (
            <span className="text-[#64748B] font-medium">{t("optimize.workspace.score")}</span>
          )}
          <span className="tabular-nums">{Math.round(matchPct)}</span>
        </div>
        <button
          type="button"
          onClick={() => void handleShare()}
          aria-disabled={!canAct}
          className={`hidden sm:inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-semibold transition ${
            canAct
              ? "border-[#4578FC]/40 bg-white text-[#4578FC] hover:bg-[#F5F8FF]"
              : "border-[#E8ECF4] bg-[#F8FAFC] text-[#94A3B8] cursor-not-allowed opacity-60"
          }`}
        >
          <ShareIcon className="h-4 w-4" />
          {t("optimize.workspace.share")}
        </button>
        <button
          type="button"
          onClick={handleExport}
          aria-disabled={!canAct}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold shadow-sm transition ${
            canAct
              ? "bg-[#4578FC] text-white hover:bg-[#3d6ae6]"
              : "bg-[#CBD5E1] text-white cursor-not-allowed opacity-70"
          }`}
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          <span className="hidden xs:inline sm:inline">{t("optimize.workspace.export")}</span>
          <ChevronDownIcon className="h-3.5 w-3.5 opacity-80" aria-hidden />
        </button>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0f172a] text-[11px] font-bold text-white"
          aria-hidden
        >
          {userInitials.slice(0, 2).toUpperCase()}
        </div>
      </div>
    </header>
  );
}
