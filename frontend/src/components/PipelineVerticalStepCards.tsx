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
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse"
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
      <ul className="flex flex-col gap-2">
        {Array.from({ length: n }, (_, i) => {
          const done = i < safeDone;
          const active = !allComplete && i === safeDone;
          const Icon = ICONS[i] ?? DocumentTextIcon;
          const sub = subtitles?.[i]?.trim();

          return (
            <li
              key={`step-${i}`}
              className={`flex items-center gap-2.5 ds-card px-3 py-2 text-left transition-[border-color,box-shadow,background-color] duration-300 sm:gap-3 sm:px-3.5 sm:py-2.5 ${
                active
                  ? "!border-[var(--accent)]/50 !shadow-[var(--shadow-md)]"
                  : done
                    ? ""
                    : "opacity-90"
              }`}
              aria-current={active ? "step" : undefined}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9 ${
                  done
                    ? "ds-icon-well ds-icon-well--success !h-8 !w-8 sm:!h-9 sm:!w-9 text-[var(--success)]"
                    : active
                      ? "ds-icon-well ds-icon-well--accent !h-8 !w-8 sm:!h-9 sm:!w-9 text-[var(--accent)]"
                      : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
                }`}
                aria-hidden
              >
                <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[13px] sm:text-[14px] font-semibold leading-snug ${
                    active ? "text-[var(--text)]" : done ? "text-[var(--text-muted)]" : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {labels[i]}
                </p>
                {sub ? (
                  <p
                    className={`mt-0.5 truncate text-[11px] sm:text-[12px] leading-snug ${
                      done ? "text-[var(--text-muted)]" : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    {sub}
                  </p>
                ) : null}
              </div>
              <div className="flex w-7 shrink-0 flex-col items-center justify-center self-center sm:w-8">
                {done ? (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--success)] text-white sm:h-7 sm:w-7">
                    <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  </span>
                ) : active ? (
                  <LoadingDots />
                ) : (
                  <span className="h-6 w-6 rounded-full border border-[var(--border)] bg-white sm:h-7 sm:w-7" aria-hidden />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
