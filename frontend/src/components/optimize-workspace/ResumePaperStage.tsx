import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  measureAnnotationAnchors,
  type AnnotationAnchorMap,
} from "./annotationAnchors";
import type { WorkspaceAnnotation } from "../../api";
import { t } from "../../i18n";

export type { AnnotationAnchorMap };
/** @deprecated use AnnotationAnchorMap */
export type SectionAnchorMap = AnnotationAnchorMap;

export const A4_CSS_WIDTH = 520;
export const A4_ASPECT = 297 / 210;
export const A4_CSS_HEIGHT = Math.round(A4_CSS_WIDTH * A4_ASPECT);

const ZOOM_MIN = 70;
const ZOOM_MAX = 160;
const HL_STYLE_ID = "ws-hl-style";
const HL_ATTR = "data-ws-hl";

function clampZoom(z: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z)));
}

function ensureHlStyle(doc: Document) {
  if (doc.getElementById(HL_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = HL_STYLE_ID;
  style.textContent = `
    [${HL_ATTR}] {
      background: rgba(69, 120, 252, 0.22) !important;
      box-shadow: inset 0 0 0 1px rgba(69, 120, 252, 0.4);
      border-radius: 2px;
      outline: none;
    }
  `;
  doc.head.appendChild(style);
}

/**
 * Wrap body children once, measure natural size WITHOUT height constraints
 * (constrained height + overflow:hidden was clipping ~half the resume), then
 * scale the wrapper to fit one A4 viewport.
 */
function fitIframeContentToA4(doc: Document, iframe: HTMLIFrameElement) {
  const body = doc.body;
  if (!body) return;
  let wrap = doc.getElementById("ws-a4-fit") as HTMLElement | null;
  if (!wrap) {
    wrap = doc.createElement("div");
    wrap.id = "ws-a4-fit";
    while (body.firstChild) wrap.appendChild(body.firstChild);
    body.appendChild(wrap);
  }

  const html = doc.documentElement;
  html.style.margin = "0";
  html.style.padding = "0";
  html.style.height = "100%";
  html.style.overflow = "hidden";
  body.style.margin = "0";
  body.style.padding = "0";
  body.style.background = "#fff";
  // Measure unconstrained first — never clip before scale
  body.style.height = "auto";
  body.style.minHeight = "0";
  body.style.overflow = "visible";
  wrap.style.transform = "";
  wrap.style.transformOrigin = "top left";
  wrap.style.width = "100%";
  wrap.style.maxWidth = "none";
  wrap.style.margin = "0";
  wrap.style.padding = "0";
  wrap.style.height = "auto";

  const viewW = Math.max(iframe.clientWidth || A4_CSS_WIDTH, 1);
  const viewH = Math.max(iframe.clientHeight || A4_CSS_HEIGHT, 1);
  const naturalH = Math.max(wrap.scrollHeight, wrap.offsetHeight, 1);
  const naturalW = Math.max(wrap.scrollWidth, wrap.offsetWidth, 1);
  const scale = Math.min(1, viewH / naturalH, viewW / naturalW);

  wrap.style.transformOrigin = "top left";
  if (scale < 0.999) {
    wrap.style.width = `${(100 / scale).toFixed(4)}%`;
    wrap.style.transform = `scale(${scale})`;
  } else {
    wrap.style.width = "100%";
    wrap.style.transform = "";
  }

  body.style.height = "100%";
  body.style.overflow = "hidden";
}

export function ResumePaperStage({
  previewUrl,
  paperHtml,
  paperText,
  paperEditable,
  onPaperTextChange,
  fallbackName,
  annotations,
  focusedId,
  onFocusAnnotation,
  onExport,
  onPaperHeight,
  onSectionAnchors,
  onPaperReady,
}: {
  previewUrl: string | null;
  paperHtml?: string | null;
  paperText?: string | null;
  paperEditable?: boolean;
  onPaperTextChange?: (text: string) => void;
  fallbackName?: string;
  annotations: WorkspaceAnnotation[];
  focusedId: string | null;
  onFocusAnnotation: (id: string) => void;
  onExport: () => void;
  onPaperHeight?: (h: number) => void;
  onSectionAnchors?: (anchors: AnnotationAnchorMap) => void;
  onPaperReady?: (ready: boolean) => void;
}) {
  const [zoom, setZoom] = useState(100);
  const paperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const textEditorRef = useRef<HTMLDivElement>(null);
  const inputCleanupRef = useRef<(() => void) | null>(null);
  const annRef = useRef(annotations);
  annRef.current = annotations;
  const [localAnchors, setLocalAnchors] = useState<AnnotationAnchorMap>({});
  const [paperReady, setPaperReady] = useState(false);

  const mode: "html" | "image" | "text" | "skeleton" = paperHtml?.trim()
    ? "html"
    : previewUrl
      ? "image"
      : paperText?.trim()
        ? "text"
        : "skeleton";

  const setReady = (ready: boolean) => {
    setPaperReady(ready);
    onPaperReady?.(ready);
  };

  const reportGeometry = () => {
    const paper = paperRef.current;
    if (!paper) return;
    onPaperHeight?.(paper.offsetHeight);
    if (mode !== "html") return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc?.body || !iframe) return;
    fitIframeContentToA4(doc, iframe);
    const map = measureAnnotationAnchors(doc, paper, annRef.current);
    setLocalAnchors(map);
    onSectionAnchors?.(map);
    setReady(true);
  };

  useLayoutEffect(() => {
    if (mode === "image" || mode === "text") {
      setReady(true);
      const paper = paperRef.current;
      if (paper) onPaperHeight?.(paper.offsetHeight);
    } else if (mode === "skeleton") {
      setReady(false);
      setLocalAnchors({});
      onSectionAnchors?.({});
    }
  }, [mode, previewUrl, paperText]);

  useEffect(() => {
    if (mode === "html") {
      setReady(false);
      setLocalAnchors({});
      onSectionAnchors?.({});
    }
  }, [paperHtml, mode]);

  useEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      onPaperHeight?.(el.offsetHeight);
      if (mode === "html" && paperReady) reportGeometry();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, paperReady, paperHtml]);

  // Re-measure when annotation set changes (same HTML)
  useEffect(() => {
    if (mode === "html" && paperReady) reportGeometry();
  }, [annotations, mode, paperReady]);

  useEffect(() => {
    if (mode !== "text" || !textEditorRef.current) return;
    const el = textEditorRef.current;
    if (document.activeElement === el) return;
    if (el.innerText !== (paperText || "")) {
      el.innerText = paperText || "";
    }
  }, [mode, paperText]);

  // Highlight the resolved DOM target for the focused annotation
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    ensureHlStyle(doc);
    doc.querySelectorAll(`[${HL_ATTR}]`).forEach((el) => el.removeAttribute(HL_ATTR));
    if (!paperReady || !focusedId) return;
    const anchor = localAnchors[focusedId];
    const sel = anchor?.targetSelector;
    const target = sel
      ? doc.querySelector<HTMLElement>(sel)
      : null;
    if (target) {
      target.setAttribute(HL_ATTR, "1");
      return;
    }
    const ann = annotations.find((a) => a.id === focusedId);
    if (ann?.section) {
      const fallback = doc.querySelector<HTMLElement>(
        `[data-section="${CSS.escape(ann.section)}"]`,
      );
      fallback?.setAttribute(HL_ATTR, "1");
    }
  }, [focusedId, annotations, paperReady, paperHtml, localAnchors]);

  function wireIframe() {
    inputCleanupRef.current?.();
    inputCleanupRef.current = null;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc?.body || !iframe) return;
    ensureHlStyle(doc);
    // Wait a frame for template CSS / images to settle
    requestAnimationFrame(() => {
      fitIframeContentToA4(doc, iframe);
      if (paperEditable !== false) {
        doc.body.contentEditable = "true";
        doc.body.style.outline = "none";
        const onInput = () => {
          onPaperTextChange?.(doc.body?.innerText || "");
          reportGeometry();
        };
        doc.body.addEventListener("input", onInput);
        inputCleanupRef.current = () => doc.body?.removeEventListener("input", onInput);
      }
      reportGeometry();
      window.setTimeout(() => reportGeometry(), 120);
      window.setTimeout(() => setReady(true), 350);
    });
  }

  useEffect(() => () => inputCleanupRef.current?.(), []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoomHint, setZoomHint] = useState(false);
  const zoomHintTimer = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  function bumpZoom(next: number) {
    setZoom(clampZoom(next));
    setZoomHint(true);
    if (zoomHintTimer.current) window.clearTimeout(zoomHintTimer.current);
    zoomHintTimer.current = window.setTimeout(() => setZoomHint(false), 700);
  }

  // Pinch (trackpad) / Ctrl+wheel zoom — plain scroll still pans the paper
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch) return;
      e.preventDefault();
      const delta = -e.deltaY;
      const step = Math.abs(delta) > 40 ? 8 : 4;
      bumpZoom(zoomRef.current + (delta > 0 ? step : -step));
    };

    const onGesture = (e: Event) => {
      const ge = e as Event & { scale?: number };
      e.preventDefault?.();
      if (typeof ge.scale === "number" && Number.isFinite(ge.scale)) {
        bumpZoom(100 * ge.scale);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGesture as EventListener, { passive: false });
    el.addEventListener("gesturechange", onGesture as EventListener, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGesture as EventListener);
      el.removeEventListener("gesturechange", onGesture as EventListener);
      if (zoomHintTimer.current) window.clearTimeout(zoomHintTimer.current);
    };
  }, []);

  const paperWidthPct = Math.min(100, zoom);

  return (
    <div className="optimize-ws-paper relative flex min-h-0 flex-1 flex-col items-center pt-0">
      <div
        ref={scrollRef}
        className="relative w-full max-w-[560px] flex-1 overflow-auto pb-20 pt-0 px-0 sm:px-1"
        title={t("optimize.workspace.zoomHint")}
      >
        <div
          className="relative mx-auto"
          style={{
            width: `${paperWidthPct}%`,
            maxWidth: A4_CSS_WIDTH,
            transform: zoom > 100 ? `scale(${zoom / 100})` : undefined,
            transformOrigin: "top center",
          }}
        >
          <div
            ref={paperRef}
            data-ws-paper
            className="optimize-ws-a4 relative w-full bg-white rounded-sm"
            style={{ aspectRatio: "210 / 297" }}
          >
            <div className="absolute inset-0 overflow-hidden rounded-sm">
              {mode === "html" && paperHtml ? (
                <iframe
                  ref={iframeRef}
                  title={fallbackName || "Resume"}
                  srcDoc={paperHtml}
                  className="absolute inset-0 z-[1] block h-full w-full border-0 bg-white"
                  sandbox="allow-same-origin"
                  onLoad={() => wireIframe()}
                />
              ) : null}

              {mode === "image" && previewUrl ? (
                <img
                  src={previewUrl}
                  alt={fallbackName || "Resume"}
                  className="absolute inset-0 h-full w-full object-contain object-top bg-white"
                  draggable={false}
                />
              ) : null}

              {mode === "text" ? (
                <div
                  ref={textEditorRef}
                  role="textbox"
                  aria-label={t("optimize.workspace.editResume")}
                  aria-multiline
                  contentEditable={paperEditable !== false}
                  suppressContentEditableWarning
                  spellCheck
                  className={`absolute inset-0 z-[1] overflow-auto whitespace-pre-wrap break-words px-8 py-9 text-[12.5px] leading-[1.55] text-[#0f172a] outline-none ${
                    paperEditable !== false ? "caret-[#4578FC]" : ""
                  }`}
                  onInput={(e) => onPaperTextChange?.(e.currentTarget.innerText)}
                />
              ) : null}

              {(mode === "skeleton" || (mode === "html" && !paperHtml)) && (
                <div className="absolute inset-0 flex flex-col gap-3 bg-white p-8">
                  <div className="h-5 w-40 rounded bg-[#E2E8F0] animate-pulse" />
                  <div className="h-3 w-28 rounded bg-[#F1F5F9] animate-pulse" />
                  <div className="mt-4 space-y-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                      <div
                        key={i}
                        className="h-2.5 rounded bg-[#F8FAFC] animate-pulse"
                        style={{ width: `${70 + (i % 3) * 10}%` }}
                      />
                    ))}
                  </div>
                  <p className="mt-auto text-center text-[12px] text-[#94A3B8]">{fallbackName || "Resume"}</p>
                </div>
              )}

              {mode === "html" && paperHtml && !paperReady && (
                <div className="pointer-events-none absolute inset-0 z-[2] bg-white/40" aria-hidden />
              )}
            </div>
          </div>
        </div>
      </div>

      {zoomHint && (
        <div
          className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-[#E8ECF4] bg-white/95 px-3 py-1 text-[12px] font-semibold tabular-nums text-[#334155] shadow-sm"
          aria-live="polite"
        >
          {zoom}%
        </div>
      )}
    </div>
  );
}
