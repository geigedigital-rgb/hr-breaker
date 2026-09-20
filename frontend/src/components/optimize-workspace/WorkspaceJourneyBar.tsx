import {
  MagnifyingGlassIcon,
  SparklesIcon,
  SwatchIcon,
} from "@heroicons/react/24/solid";
import type { ComponentType } from "react";
import { t } from "../../i18n";

export type JourneyStepId = "recommendations" | "improve" | "style";

type StepState = "done" | "current" | "upcoming";

const STEP_ICONS: Record<
  JourneyStepId,
  ComponentType<{ className?: string }>
> = {
  recommendations: MagnifyingGlassIcon,
  improve: SparklesIcon,
  style: SwatchIcon,
};

function StepDot({ id, state }: { id: JourneyStepId; state: StepState }) {
  const Icon = STEP_ICONS[id];
  if (state === "done") {
    return (
      <span className="optimize-ws-journey-dot optimize-ws-journey-dot--done flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white">
        <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="optimize-ws-journey-dot optimize-ws-journey-dot--current flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--accent)]">
        <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
      </span>
    );
  }
  return (
    <span className="optimize-ws-journey-dot optimize-ws-journey-dot--upcoming flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#64748B]">
      <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
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

  return (
    <nav className="optimize-ws-journey pointer-events-auto" aria-label={t("optimize.workspace.journeyAria")}>
      <div className="optimize-ws-journey-glass w-full max-w-[420px] overflow-hidden rounded-[1.25rem]">
        <ol className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-x-0 px-3 py-3 sm:px-4">
          {steps.map((step, i) => {
            // Style is reachable after analysis (preview templates); Improve stays gated.
            const enabled =
              step.state !== "upcoming" ||
              (step.id === "style" && hasRecommendations);
            const prevDone = i > 0 && steps[i - 1].state === "done";
            return (
              <li key={step.id} className="contents">
                {i > 0 && (
                  <span
                    className={`optimize-ws-journey-rail mx-1.5 h-[2px] w-7 shrink-0 rounded-full sm:mx-2 sm:w-9 ${
                      prevDone ? "optimize-ws-journey-rail--on" : ""
                    }`}
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => onStepClick(step.id)}
                  className={`optimize-ws-journey-step group flex w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl px-1.5 py-1.5 transition sm:px-2 ${
                    step.state === "current" ? "optimize-ws-journey-step--current" : ""
                  } ${
                    !enabled
                      ? "cursor-default"
                      : "hover:bg-white/40"
                  }`}
                >
                  <StepDot id={step.id} state={step.state} />
                  <span
                    className={`w-full truncate text-center text-[11px] font-semibold leading-tight tracking-tight ${
                      step.state === "current"
                        ? "text-[var(--accent)]"
                        : step.state === "done"
                          ? "text-[#1E293B]"
                          : enabled
                            ? "text-[#475569]"
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
      </div>
    </nav>
  );
}
