import { Fragment } from "react";
import { CheckIcon } from "@heroicons/react/20/solid";

const ACCENT = "#4558ff";
const ACCENT_SOFT = "#7b8ef9";
/** Visible on app canvas (#F2F3F9) without looking like a heavy bar */
const TRACK_PENDING = "#D2D8E5";

type PipelineStepperProps = {
  /** Step labels (1–5); extra entries are ignored */
  labels: readonly string[];
  /** How many steps are fully done (checkmarks), 0 … labels.length */
  completedSteps: number;
  /** Optional id for aria */
  id?: string;
};

/**
 * Horizontal “AI pipeline” stepper: numbered active step, checkmarks when done.
 * Connectors are single flex segments between nodes so the chain stays continuous.
 */
export function PipelineStepper({ labels, completedSteps, id }: PipelineStepperProps) {
  const n = Math.min(5, Math.max(1, labels.length));
  const safeDone = Math.max(0, Math.min(n, Math.floor(completedSteps)));
  const activeIndex = safeDone < n ? safeDone : n - 1;
  const allComplete = safeDone >= n;

  return (
    <div
      id={id}
      className="w-full max-w-[min(36rem,100%)] mx-auto bg-transparent px-0 py-0"
      role="group"
      aria-label="Progress"
    >
      {/* Track: one connector = one flex segment between circles (no split halves) */}
      <div className="flex w-full items-center justify-center">
        {Array.from({ length: n }, (_, i) => {
          const done = i < safeDone;
          const active = !allComplete && i === activeIndex;
          /** Segment before node i connects node i-1 → i; filled when step i is reached */
          const segmentDone = i > 0 && safeDone >= i;

          return (
            <Fragment key={i}>
              {i > 0 ? (
                <div
                  className="flex-1 min-w-[6px] h-px rounded-full self-center transition-[background-color,box-shadow] duration-500 ease-out origin-center"
                  style={{
                    backgroundColor: segmentDone ? ACCENT_SOFT : TRACK_PENDING,
                    boxShadow: segmentDone ? "0 0 0 0.5px rgba(69, 88, 255, 0.12)" : "none",
                  }}
                  aria-hidden
                />
              ) : null}
              <div className="relative flex w-[4.75rem] shrink-0 justify-center sm:w-[5.35rem]">
                <div
                  className={`relative z-[1] flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full text-[10px] sm:text-[11px] font-bold transition-all duration-300 ease-out ${
                    done
                      ? "text-white shadow-[0_2px_10px_rgba(69,88,255,0.28)]"
                      : active
                        ? "text-white shadow-[0_3px_12px_rgba(69,88,255,0.32)]"
                        : "border border-[#D0D6E2] bg-white/90 text-[#9aa3b8] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                  }`}
                  style={
                    done || active
                      ? {
                          background: `linear-gradient(145deg, ${ACCENT_SOFT} 0%, ${ACCENT} 55%, #3d52e6 100%)`,
                          borderColor: "transparent",
                        }
                      : undefined
                  }
                  aria-current={active ? "step" : undefined}
                >
                  {done ? (
                    <CheckIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* Labels — same flex rhythm so text stays under nodes */}
      <div className="mt-3 flex w-full items-start justify-center sm:mt-3.5">
        {Array.from({ length: n }, (_, i) => {
          const done = i < safeDone;
          const active = !allComplete && i === activeIndex;
          return (
            <Fragment key={`l-${i}`}>
              {i > 0 ? <div className="flex-1 min-w-[6px] shrink-0" aria-hidden /> : null}
              <div className="w-[4.75rem] shrink-0 px-0.5 sm:w-[5.35rem]">
                <p
                  className={`line-clamp-2 max-h-[2.6em] text-center text-[9px] sm:text-[10px] leading-tight ${
                    done
                      ? "text-[#64748b] font-medium"
                      : active
                        ? "text-[#181819] font-semibold"
                        : "text-[#9aa3b8] font-medium"
                  }`}
                  title={labels[i]}
                >
                  {labels[i]}
                </p>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
