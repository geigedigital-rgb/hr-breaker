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
      <span className="optimize-ws-journey-dot optimize-ws-journey-dot--done flex h-9 w-9 items-center justify-center rounded-full text-white">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="optimize-ws-journey-dot optimize-ws-journey-dot--current flex h-9 w-9 items-center justify-center rounded-full text-[var(--accent)]">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
    );
  }
  return (
    <span className="optimize-ws-journey-dot optimize-ws-journey-dot--upcoming flex h-9 w-9 items-center justify-center rounded-full text-[#94A3B8]">
      <Icon className="h-5 w-5" aria-hidden />
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
  if (!hasImproved) return "upcoming";
  if (hasStyled) return "done";
  return "current";
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
      <div className="optimize-ws-journey-glass flex w-full max-w-[480px] items-stretch overflow-hidden rounded-[1.25rem]">
        <ol className="flex min-w-0 flex-1 items-center gap-0 px-3 py-2.5 sm:px-4">
          {steps.map((step, i) => {
            const enabled = step.state !== "upcoming";
            const prevDone = i > 0 && steps[i - 1].state === "done";
            return (
              <li key={step.id} className="flex min-w-0 flex-1 items-center">
                {i > 0 && (
                  <span
                    className={`optimize-ws-journey-rail mx-1 h-[2px] min-w-[10px] flex-1 rounded-full sm:mx-1.5 sm:min-w-[18px] ${
                      prevDone ? "optimize-ws-journey-rail--on" : ""
                    }`}
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => onStepClick(step.id)}
                  className={`optimize-ws-journey-step group flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-2 py-1.5 transition sm:px-2.5 ${
                    step.state === "current" ? "optimize-ws-journey-step--current" : ""
                  } ${!enabled ? "cursor-default opacity-50" : "hover:bg-white/35"}`}
                >
                  <StepDot id={step.id} state={step.state} />
                  <span
                    className={`max-w-[5.2rem] truncate text-center text-[10px] font-semibold leading-none sm:max-w-none sm:text-[11px] ${
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
      </div>
    </nav>
  );
}
