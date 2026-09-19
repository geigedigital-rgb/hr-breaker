import { useMemo, useState } from "react";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  PlusCircleIcon,
} from "@heroicons/react/24/solid";
import type { WorkspaceAnnotation } from "../../api";
import { t } from "../../i18n";

const PREVIEW = 8;

/** positive (good) → warning (critical) → suggestion (add) */
function severityRank(sev: string): number {
  if (sev === "positive") return 0;
  if (sev === "warning") return 1;
  if (sev === "suggestion") return 2;
  return 3;
}

export function sortAnnotationsByPriority(annotations: WorkspaceAnnotation[]): WorkspaceAnnotation[] {
  return [...annotations].sort((a, b) => {
    const d = severityRank(a.severity) - severityRank(b.severity);
    if (d !== 0) return d;
    return (a.anchor_y ?? 0.5) - (b.anchor_y ?? 0.5);
  });
}

function tone(sev: string) {
  if (sev === "positive") {
    return {
      Icon: CheckCircleIcon,
      iconCls: "text-emerald-500/80",
      border: "border-dashed border-emerald-200/80",
      bg: "bg-emerald-50/40",
    };
  }
  if (sev === "warning") {
    return {
      Icon: ExclamationCircleIcon,
      iconCls: "text-amber-500",
      border: "border-dashed border-amber-300/70",
      bg: "bg-amber-50/30",
    };
  }
  return {
    Icon: PlusCircleIcon,
    iconCls: "text-sky-500",
    border: "border-dashed border-sky-300/70",
    bg: "bg-sky-50/30",
  };
}

export function AnnotationRail({
  annotations,
  focusedId,
  onFocus,
}: {
  annotations: WorkspaceAnnotation[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  /** @deprecated kept for call-site compat — ignored */
  paperHeight?: number;
  sectionAnchors?: unknown;
  paperReady?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const sorted = useMemo(() => sortAnnotationsByPriority(annotations), [annotations]);
  const list = useMemo(
    () => (expanded ? sorted : sorted.slice(0, PREVIEW)),
    [sorted, expanded],
  );
  const hasMore = sorted.length > PREVIEW;

  if (!sorted.length) return null;

  return (
    <div className="optimize-ws-annotations flex w-full flex-col gap-2.5">
      {list.map((a) => {
        const { Icon, iconCls, border, bg } = tone(a.severity);
        const active = focusedId === a.id;
        return (
          <button
            key={a.id}
            type="button"
            data-ws-ann-card={a.id}
            onClick={() => onFocus(a.id)}
            className={`relative w-full text-left rounded-xl border px-2.5 py-2 transition ${border} ${bg} ${
              active ? "ring-1 ring-[#4578FC]/40 bg-white/90" : "hover:bg-white/80"
            }`}
          >
            <div className="flex items-start gap-2">
              <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconCls}`} aria-hidden />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-[#334155] leading-snug">{a.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-[#64748B]">{a.body}</p>
              </div>
            </div>
          </button>
        );
      })}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-left text-[12px] font-medium text-[#64748B] hover:text-[#0f172a]"
        >
          {expanded
            ? t("optimize.workspace.showLessAnnotations")
            : t("optimize.workspace.showMoreAnnotations")}
        </button>
      )}
    </div>
  );
}
