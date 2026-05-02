import type { ComponentType } from "react";
import {
  ArrowTrendingUpIcon,
  BriefcaseIcon,
  ChartBarIcon,
  DocumentTextIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { CheckIcon } from "@heroicons/react/20/solid";

const ICONS: ComponentType<{ className?: string; strokeWidth?: number }>[] = [
  DocumentTextIcon,
  BriefcaseIcon,
  ChartBarIcon,
  Squares2X2Icon,
  ArrowTrendingUpIcon,
];

function LoadingDots() {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-[#4578FC] animate-pulse"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </div>
  );
}

export type PipelineVerticalStepCardsProps = {
  labels: readonly string[];
  /** Same length as labels; optional second line per row */
  subtitles?: readonly string[];
  /** How many steps are fully complete (0 … labels.length) */
  completedSteps: number;
  id?: string;
};

/**
 * Vertical status cards: completed steps show a green check; the current step is highlighted with a blue border and loading dots.
 */
export function PipelineVerticalStepCards({ labels, subtitles, completedSteps, id }: PipelineVerticalStepCardsProps) {
  const n = Math.min(5, Math.max(1, labels.length));
  const safeDone = Math.max(0, Math.min(n, Math.floor(completedSteps)));
  const allComplete = safeDone >= n;

  return (
    <div id={id} className="w-full max-w-md mx-auto" role="group" aria-label="Progress">
      <ul className="flex flex-col gap-3">
        {Array.from({ length: n }, (_, i) => {
          const done = i < safeDone;
          const active = !allComplete && i === safeDone;
          const Icon = ICONS[i] ?? DocumentTextIcon;
          const sub = subtitles?.[i]?.trim();

          return (
            <li
              key={`step-${i}`}
              className={`flex items-stretch gap-3 rounded-2xl border px-3.5 py-3.5 text-left transition-[border-color,box-shadow,background-color] duration-300 sm:gap-4 sm:px-4 sm:py-4 ${
                active
                  ? "border-[#4578FC]/70 bg-white shadow-[0_4px_20px_-8px_rgba(69,120,252,0.35)]"
                  : done
                    ? "border-[#E8ECF4] bg-white/90"
                    : "border-[#EEF1F7] bg-[#fafbfc]/90"
              }`}
              aria-current={active ? "step" : undefined}
            >
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12 ${
                  done
                    ? "bg-emerald-50 text-emerald-600"
                    : active
                      ? "bg-[#EEF3FF] text-[#4578FC]"
                      : "bg-[#F1F4F9] text-[#94a3b8]"
                }`}
                aria-hidden
              >
                <Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                <p
                  className={`text-[14px] sm:text-[15px] font-semibold leading-snug ${
                    active ? "text-[#0f172a]" : done ? "text-[#334155]" : "text-[#64748b]"
                  }`}
                >
                  {labels[i]}
                </p>
                {sub ? (
                  <p className={`mt-0.5 text-[12px] sm:text-[13px] leading-snug ${done ? "text-[#64748b]" : "text-[#94a3b8]"}`}>
                    {sub}
                  </p>
                ) : null}
              </div>
              <div className="flex w-9 shrink-0 flex-col items-center justify-center self-center sm:w-10">
                {done ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                    <CheckIcon className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                  </span>
                ) : active ? (
                  <LoadingDots />
                ) : (
                  <span className="h-8 w-8 rounded-full border border-[#E2E8F0] bg-white" aria-hidden />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
