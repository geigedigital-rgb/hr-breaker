import { CheckIcon } from "@heroicons/react/24/solid";
import { t } from "../../i18n";

export type JourneyStepId = "recommendations" | "improve" | "style";

type StepState = "done" | "current" | "upcoming";

function StepDot({ state, index }: { state: StepState; index: number }) {
  if (state === "done") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_2px_8px_rgba(69,120,252,0.35)]">
        <CheckIcon className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-bold text-[var(--accent)] ring-2 ring-[var(--accent)] shadow-[0_0_0_4px_rgba(69,120,252,0.12)]">
        {index}
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold text-[#94A3B8]">
      {index}
    </span>
  );
}

function stepState(
  id: JourneyStepId,
  hasRecommendations: boolean,
  hasImproved: boolean,
  hasStyled: boolean,
): StepState {
  if (id === "recommendations") {
    if (!hasRecommendations) return "upcoming";
    return "done";
  }
  if (id === "improve") {
    if (hasImproved) return "done";
    if (hasRecommendations) return "current";
    return "upcoming";
  }
  // style
  if (hasStyled) return "done";
  if (hasImproved) return "current";
  return "upcoming";
}

export function WorkspaceJourneyBar({
  hasRecommendations,
  hasImproved,
  hasStyled,
  onStepClick,
}: {
  hasRecommendations: boolean;
  hasImproved: boolean;
  hasStyled: boolean;
  onStepClick: (id: JourneyStepId) => void;
}) {
  const steps: { id: JourneyStepId; label: string; state: StepState }[] = [
    {
      id: "recommendations",
      label: t("optimize.workspace.journeyRecommendations"),
      state: stepState("recommendations", hasRecommendations, hasImproved, hasStyled),
    },
    {
      id: "improve",
      label: t("optimize.workspace.journeyImprove"),
      state: stepState("improve", hasRecommendations, hasImproved, hasStyled),
    },
    {
      id: "style",
      label: t("optimize.workspace.journeyStyle"),
      state: stepState("style", hasRecommendations, hasImproved, hasStyled),
    },
  ];

  const doneCount = steps.filter((s) => s.state === "done").length;
  const progressLabel = t("optimize.workspace.journeyProgress")
    .replace("{done}", String(doneCount))
    .replace("{total}", "3");

  return (
    <nav
      className="optimize-ws-journey pointer-events-auto flex w-full max-w-[520px] items-center gap-2 rounded-2xl border border-[#E8ECF4]/90 bg-white/80 px-3 py-2 shadow-[0_8px_28px_rgba(15,23,42,0.08)] backdrop-blur-md"
      aria-label={t("optimize.workspace.journeyAria")}
    >
      <div className="hidden sm:flex shrink-0 flex-col leading-tight border-r border-[#E8ECF4] pr-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">
          {t("optimize.workspace.journeyPath")}
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-[var(--accent)]">{progressLabel}</span>
      </div>

      <ol className="flex min-w-0 flex-1 items-center">
        {steps.map((step, i) => {
          const enabled = step.state !== "upcoming";
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center">
              {i > 0 && (
                <span
                  className={`mx-0.5 h-0.5 min-w-[8px] flex-1 rounded-full sm:mx-1 sm:min-w-[14px] ${
                    steps[i - 1].state === "done" ? "bg-[var(--accent)]/65" : "bg-[#E8ECF4]"
                  }`}
                  aria-hidden
                />
              )}
              <button
                type="button"
                disabled={!enabled}
                onClick={() => onStepClick(step.id)}
                className={`group flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1 transition sm:px-1.5 ${
                  step.state === "current" ? "bg-[var(--accent-soft)]/70" : enabled ? "hover:bg-[#F8FAFC]" : ""
                } ${!enabled ? "cursor-default opacity-55" : ""}`}
              >
                <StepDot state={step.state} index={i + 1} />
                <span
                  className={`max-w-[4.8rem] truncate text-center text-[10px] font-semibold leading-tight sm:max-w-[6.5rem] sm:text-[11px] ${
                    step.state === "current"
                      ? "text-[var(--accent)]"
                      : step.state === "done"
                        ? "text-[#334155]"
                        : "text-[#94A3B8]"
                  }`}
                >
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
