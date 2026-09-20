import { useId, useState, type ReactNode } from "react";
import { SwatchIcon } from "@heroicons/react/24/outline";
import type { CategoryScores, ChangeDetailOut, JobPostingOut } from "../../api";
import { t } from "../../i18n";

type Tab = "match" | "style";

function MatchTargetIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="5.25" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
    </svg>
  );
}

function Donut({
  value,
  size = 132,
  label,
}: {
  value: number;
  size?: number;
  label: string;
}) {
  const id = useId().replace(/:/g, "");
  const pct = Math.max(0, Math.min(100, value));
  const r = 40;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id={`donut-${id}`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22D3EE" />
            <stop offset="55%" stopColor="#34D399" />
            <stop offset="100%" stopColor="#22C55E" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#EEF2F7" strokeWidth="11" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={`url(#donut-${id})`}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
        <span className="text-[10px] font-medium leading-tight text-[#94A3B8]">{label}</span>
        <span className="mt-0.5 flex items-baseline gap-0.5 leading-none">
          <span className="text-[28px] font-bold tabular-nums tracking-tight text-[#0f172a]">{Math.round(pct)}</span>
          <span className="text-[12px] font-medium text-[#94A3B8]">/ 100</span>
        </span>
      </div>
    </div>
  );
}

const BAR_COLORS: Record<keyof CategoryScores, string> = {
  content: "#22C55E",
  keywords: "#3B82F6",
  impact: "#A855F7",
  formatting: "#14B8A6",
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-medium text-[#64748B]">{label}</p>
      <div className="flex items-center gap-2.5">
        <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#EEF2F7]">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
        </div>
        <span className="w-7 shrink-0 text-right text-[13px] font-bold tabular-nums text-[#0f172a]">
          {Math.round(pct)}
        </span>
      </div>
    </div>
  );
}

export function InsightTabs({
  atsScore,
  categoryScores,
  preAts,
  isImproveMode,
  keyChanges,
  stylePanel,
  showStyle = false,
  tab: tabProp,
  onTabChange,
}: {
  atsScore: number | null;
  categoryScores: CategoryScores | null;
  preAts?: number | null;
  /** Kept for API compatibility; Job tab removed. */
  job?: JobPostingOut | null;
  isImproveMode: boolean;
  missingKeywords?: string[];
  keyChanges?: ChangeDetailOut[] | null;
  stylePanel: ReactNode;
  /** Style tab only after resume has been improved. */
  showStyle?: boolean;
  tab?: Tab;
  onTabChange?: (tab: Tab) => void;
}) {
  const [tabInternal, setTabInternal] = useState<Tab>("match");
  const tab = tabProp ?? tabInternal;
  const setTab = (next: Tab) => {
    onTabChange?.(next);
    if (tabProp == null) setTabInternal(next);
  };
  const scoreLabel = isImproveMode
    ? t("optimize.workspace.resumeScore")
    : t("optimize.workspace.atsMatch");
  const tabs: { id: Tab; label: string; Icon: (p: { className?: string }) => ReactNode }[] = [
    {
      id: "match",
      label: isImproveMode ? t("optimize.workspace.tabScore") : t("optimize.workspace.tabMatch"),
      Icon: MatchTargetIcon,
    },
    ...(showStyle
      ? [{ id: "style" as const, label: t("optimize.workspace.tabStyle"), Icon: SwatchIcon }]
      : []),
  ];

  return (
    <div className="rounded-2xl border border-[#E8ECF4] bg-white px-4 pb-4 pt-1 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
      <div className="flex gap-1 border-b border-[#E8ECF4]">
        {tabs.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`relative inline-flex flex-1 items-center justify-center gap-1.5 px-2 py-3 text-[13px] font-semibold transition ${
                active ? "text-[#4578FC]" : "text-[#94A3B8] hover:text-[#64748B]"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#4578FC]" aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      {tab === "match" && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-4">
            {atsScore != null ? (
              <Donut value={atsScore} label={scoreLabel} />
            ) : (
              <div className="flex h-[132px] w-[132px] shrink-0 flex-col items-center justify-center rounded-full border-[11px] border-[#EEF2F7] text-center">
                <span className="text-[10px] font-medium text-[#94A3B8]">{scoreLabel}</span>
                <span className="text-[22px] font-bold text-[#CBD5E1]">—</span>
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-3.5">
              {categoryScores ? (
                <>
                  <ScoreBar label={t("optimize.workspace.barContent")} value={categoryScores.content} color={BAR_COLORS.content} />
                  <ScoreBar label={t("optimize.workspace.barKeywords")} value={categoryScores.keywords} color={BAR_COLORS.keywords} />
                  <ScoreBar label={t("optimize.workspace.barImpact")} value={categoryScores.impact} color={BAR_COLORS.impact} />
                  <ScoreBar
                    label={t("optimize.workspace.barFormatting")}
                    value={categoryScores.formatting}
                    color={BAR_COLORS.formatting}
                  />
                </>
              ) : (
                <p className="text-[12px] leading-relaxed text-[#94A3B8]">{t("optimize.workspace.scoresPending")}</p>
              )}
            </div>
          </div>
          {preAts != null && atsScore != null && preAts !== atsScore && (
            <p className="text-center text-[12px] tabular-nums text-[#64748B]">
              {preAts}% → {atsScore}%
            </p>
          )}
          {keyChanges && keyChanges.length > 0 && (
            <div className="border-t border-[#E8ECF4] pt-3">
              <p className="text-[13px] font-semibold text-[#0f172a]">{t("optimize.workspace.whatChanged")}</p>
              <ul className="mt-2 space-y-2.5">
                {keyChanges.slice(0, 6).map((g, i) => {
                  const items = (g.items || []).filter(Boolean).slice(0, 4);
                  const desc = (g.description || "").trim();
                  return (
                    <li key={i} className="text-[12px] leading-snug text-[#64748B]">
                      <span className="font-semibold text-emerald-700">{g.category}</span>
                      {desc ? <span className="mt-0.5 block text-[#475569]">{desc}</span> : null}
                      {!desc && items.length > 0 ? (
                        <span className="mt-0.5 block">{items.join(" · ")}</span>
                      ) : null}
                      {desc && items.length > 0 ? (
                        <span className="mt-0.5 block text-[#94A3B8]">{items.join(" · ")}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "style" && showStyle && <div className="mt-4">{stylePanel}</div>}
    </div>
  );
}
