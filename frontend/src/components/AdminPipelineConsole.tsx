import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ClipboardDocumentIcon,
  CommandLineIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { clearAdminPipelineLog, getAdminPipelineSnapshot, subscribeAdminPipelineLog } from "../adminPipelineLogStore";

type AdminPipelineConsoleProps = {
  /** Narrow admin sidebar: icon-only entry point to the same full-screen log. */
  compact?: boolean;
};

export default function AdminPipelineConsole({ compact = false }: AdminPipelineConsoleProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [entries, setEntries] = useState(getAdminPipelineSnapshot);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeAdminPipelineLog(() => setEntries(getAdminPipelineSnapshot())), []);

  useEffect(() => {
    if (!panelOpen) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const textDump = useMemo(() => {
    return entries
      .map((e) => {
        const data = e.data && Object.keys(e.data).length ? ` ${JSON.stringify(e.data)}` : "";
        return `[${e.ts}] ${e.phase}/${e.step}: ${e.message}${data}`;
      })
      .join("\n");
  }, [entries]);

  const copyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(textDump || "(empty)");
    } catch {
      // ignore
    }
  }, [textDump]);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const overlay =
    panelOpen &&
    typeof document !== "undefined" &&
    createPortal(
      <div className="fixed inset-0 z-[200] flex items-stretch justify-center p-0 sm:p-4 md:p-6">
        <button
          type="button"
          className="absolute inset-0 bg-[#0f172a]/55 backdrop-blur-[2px]"
          aria-label="Close pipeline log"
          onClick={closePanel}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Admin pipeline log"
          className="relative z-10 flex h-full min-h-0 w-full max-w-[min(1200px,100%)] flex-col overflow-hidden rounded-none border border-[#334155] bg-[#1e293b] shadow-2xl sm:h-[min(92dvh,92vh)] sm:max-h-[min(92dvh,92vh)] sm:rounded-2xl sm:my-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-[#334155] px-4 py-3 pr-2">
            <CommandLineIcon className="h-5 w-5 shrink-0 text-[#94a3b8]" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-white">Pipeline log</h2>
              <p className="text-xs text-[#94a3b8]">
                {entries.length} event{entries.length === 1 ? "" : "s"} · analyze · optimize · Templates Lab
              </p>
            </div>
            <button
              type="button"
              onClick={copyAll}
              className="rounded-lg p-2 text-[#94a3b8] hover:bg-white/10 hover:text-white"
              title="Copy all"
              aria-label="Copy all"
            >
              <ClipboardDocumentIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => clearAdminPipelineLog()}
              className="rounded-lg p-2 text-[#94a3b8] hover:bg-white/10 hover:text-white"
              title="Clear log"
              aria-label="Clear log"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={closePanel}
              className="rounded-lg p-2 text-[#94a3b8] hover:bg-white/10 hover:text-white"
              title="Close"
              aria-label="Close"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </header>
          <pre
            className="min-h-0 flex-1 overflow-auto p-4 text-left text-[12px] leading-relaxed text-[#e2e8f0] [overflow-wrap:anywhere] font-mono whitespace-pre-wrap sm:text-[13px] sm:leading-relaxed"
            aria-live="polite"
          >
            {entries.length === 0 ? (
              <span className="text-[#64748b]">
                No events yet. Run analysis, resume improvement, or Templates Lab (load templates, extract schema, render PDF).
              </span>
            ) : (
              textDump
            )}
            <div ref={endRef} />
          </pre>
          <footer className="shrink-0 border-t border-[#334155] px-4 py-2 text-center text-[11px] text-[#64748b]">
            Escape or backdrop to close
          </footer>
        </div>
      </div>,
      document.body
    );

  return (
    <>
      <div
        className={`mt-3 shrink-0 border-t border-white/15 pt-3 ${compact ? "flex flex-col items-center gap-2" : ""}`}
      >
        {compact ? (
          <button
            type="button"
            onClick={openPanel}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/90 transition-colors hover:bg-white/15"
            title={`Pipeline log (${entries.length} events)`}
            aria-label={`Open pipeline log, ${entries.length} events`}
          >
            <CommandLineIcon className="h-5 w-5 shrink-0" aria-hidden />
            {entries.length > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-400 px-0.5 text-[10px] font-bold leading-none text-slate-900">
                {entries.length > 99 ? "99+" : entries.length}
              </span>
            ) : null}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={openPanel}
              className="flex w-full items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-left transition-colors hover:bg-white/15"
            >
              <CommandLineIcon className="h-5 w-5 shrink-0 text-white/90" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-white/90">Pipeline log</div>
                <div className="text-[11px] text-white/60">
                  {entries.length} event{entries.length === 1 ? "" : "s"} · open full console
                </div>
              </div>
              <span className="tabular-nums text-sm font-medium text-white/80">{entries.length}</span>
            </button>
            <div className="mt-1.5 flex justify-end gap-0.5">
              <button
                type="button"
                onClick={copyAll}
                className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                title="Copy log"
                aria-label="Copy log"
              >
                <ClipboardDocumentIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => clearAdminPipelineLog()}
                className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                title="Clear log"
                aria-label="Clear log"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
      {overlay}
    </>
  );
}
