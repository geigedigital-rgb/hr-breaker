import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  BoldIcon,
  ItalicIcon,
  ListBulletIcon,
  MinusIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
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
const BLOCK_ATTR = "data-ws-block";
const BLOCK_ACTIVE = "data-ws-block-active";

const SECTION_FALLBACK: Record<string, string> = {
  SECTION: "other",
  HEADER: "header",
  ASIDE: "skills",
  MAIN: "experience",
};

function clampZoom(z: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z)));
}

function sectionLabelKey(section: string): string {
  const s = (section || "other").toLowerCase();
  const known = ["header", "summary", "experience", "projects", "education", "skills", "other"] as const;
  if ((known as readonly string[]).includes(s)) return s;
  return "other";
}

function ensureEditorStyles(doc: Document) {
  let style = doc.getElementById(HL_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = HL_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = `
    /* Preview frame: fill the A4 iframe, never use viewport vh (wrong in iframe). */
    html, body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: #fff !important;
    }
    #ws-a4-fit {
      position: relative;
      box-sizing: border-box;
      transform-origin: top left;
    }
    .resume,
    .rx-vega,
    .rx-chikorita,
    .rx-ditto,
    .rx-ditgar,
    .rx-cobalt,
    .rx-onyx,
    .rx-lapras {
      min-height: 100% !important;
      box-sizing: border-box;
    }

    [${HL_ATTR}] {
      background: rgba(69, 120, 252, 0.22) !important;
      box-shadow: inset 0 0 0 1px rgba(69, 120, 252, 0.4);
      border-radius: 2px;
      outline: none;
    }
    [${BLOCK_ATTR}] {
      position: relative;
      border-radius: 4px;
      transition: box-shadow 0.12s ease, background-color 0.12s ease;
      cursor: text;
    }
    [${BLOCK_ATTR}]:hover:not([${BLOCK_ACTIVE}]) {
      box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.55);
      background-color: rgba(248, 250, 252, 0.35);
    }
    [${BLOCK_ACTIVE}] {
      box-shadow: inset 0 0 0 1.5px rgba(69, 120, 252, 0.55),
        0 0 0 3px rgba(69, 120, 252, 0.12) !important;
      background-color: rgba(69, 120, 252, 0.04) !important;
      outline: none;
    }
    [${BLOCK_ATTR}][contenteditable="true"] {
      caret-color: #4578fc;
    }
  `;
}

/**
 * Fit template HTML into the A4 iframe without letterboxing.
 * 1) Measure natural content size (ignore 100vh page-fill).
 * 2) Uniform scale-down if oversized.
 * 3) Size the wrap so after scale it exactly fills the iframe (backgrounds stay full-page).
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

  const viewW = Math.max(iframe.clientWidth || A4_CSS_WIDTH, 1);
  const viewH = Math.max(iframe.clientHeight || A4_CSS_HEIGHT, 1);

  const html = doc.documentElement;
  html.style.cssText = "margin:0;padding:0;width:100%;height:100%;overflow:hidden;";
  body.style.cssText = "margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#fff;";

  // Reset transform for an honest measure
  wrap.style.cssText =
    "position:relative;box-sizing:border-box;transform:none;transform-origin:top left;width:100%;max-width:none;margin:0;padding:0;height:auto;min-height:0;";

  // Temporarily drop page-fill min-heights so we measure real content, not vh
  const pageRoots = [
    ...wrap.querySelectorAll<HTMLElement>(
      ".resume, .rx-vega, .rx-chikorita, .rx-ditto, .rx-ditgar, .rx-cobalt, .rx-onyx, .rx-lapras",
    ),
  ];
  const prevMin = pageRoots.map((el) => el.style.minHeight);
  for (const el of pageRoots) el.style.minHeight = "0";

  // Force reflow
  void wrap.offsetHeight;
  const naturalH = Math.max(wrap.scrollHeight, wrap.offsetHeight, 1);
  const naturalW = Math.max(wrap.scrollWidth, wrap.offsetWidth, 1);

  for (let i = 0; i < pageRoots.length; i++) {
    pageRoots[i].style.minHeight = prevMin[i] || "";
  }

  const scale = Math.min(1, viewW / naturalW, viewH / naturalH);
  // Layout box before scale must be view/scale so the scaled result fills the iframe
  const layoutW = viewW / scale;
  const layoutH = viewH / scale;

  wrap.style.width = `${layoutW}px`;
  wrap.style.minHeight = `${layoutH}px`;
  wrap.style.height = `${layoutH}px`;
  wrap.style.transformOrigin = "top left";
  wrap.style.transform = scale < 0.9995 ? `scale(${scale})` : "";

  // Restore page-fill so sidebar / gradient backgrounds cover the full A4 preview
  for (const el of pageRoots) {
    el.style.minHeight = "100%";
  }
}

function discoverBlocks(doc: Document): HTMLElement[] {
  const root = doc.getElementById("ws-a4-fit") || doc.body;
  if (!root) return [];

  let blocks = [...root.querySelectorAll<HTMLElement>("[data-section]")];
  if (blocks.length === 0) {
    const candidates = [
      ...root.querySelectorAll<HTMLElement>("section, header, aside, main"),
    ];
    for (const el of candidates) {
      if (el.closest("[data-section]")) continue;
      const tag = el.tagName;
      const guess =
        SECTION_FALLBACK[tag] ||
        (el.className.toLowerCase().includes("skill") ? "skills" : "other");
      el.setAttribute("data-section", guess);
      blocks.push(el);
    }
  }

  // Prefer leaf sections so nested wrappers don't steal focus
  const leaves = blocks.filter((el) => el.querySelectorAll("[data-section]").length === 0);
  return leaves.length > 0 ? leaves : blocks;
}

function activateBlock(doc: Document, block: HTMLElement | null, editable: boolean) {
  doc.querySelectorAll(`[${BLOCK_ACTIVE}]`).forEach((el) => {
    el.removeAttribute(BLOCK_ACTIVE);
    if (editable) (el as HTMLElement).contentEditable = "false";
  });
  if (!block) return;
  block.setAttribute(BLOCK_ACTIVE, "1");
  if (editable) {
    block.contentEditable = "true";
    block.focus({ preventScroll: true });
  }
}

function blockFromNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  return el?.closest<HTMLElement>(`[${BLOCK_ATTR}]`) || null;
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
  const editableRef = useRef(paperEditable !== false);
  editableRef.current = paperEditable !== false;
  const onTextChangeRef = useRef(onPaperTextChange);
  onTextChangeRef.current = onPaperTextChange;

  const [localAnchors, setLocalAnchors] = useState<AnnotationAnchorMap>({});
  const [paperReady, setPaperReady] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [fmtState, setFmtState] = useState({ bold: false, italic: false });

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

  const reportGeometry = useCallback(() => {
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
  }, [mode, onPaperHeight, onSectionAnchors]);

  const syncFmtState = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      setFmtState({ bold: false, italic: false });
      return;
    }
    try {
      setFmtState({
        bold: Boolean(doc.queryCommandState("bold")),
        italic: Boolean(doc.queryCommandState("italic")),
      });
    } catch {
      setFmtState({ bold: false, italic: false });
    }
  }, []);

  const runCommand = useCallback(
    (command: string, value?: string) => {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!doc) return;
      const active = doc.querySelector<HTMLElement>(`[${BLOCK_ACTIVE}]`);
      if (active && editableRef.current) {
        active.contentEditable = "true";
        active.focus({ preventScroll: true });
      }
      try {
        doc.execCommand(command, false, value);
      } catch {
        /* ignore */
      }
      onTextChangeRef.current?.(doc.body?.innerText || "");
      syncFmtState();
      reportGeometry();
    },
    [reportGeometry, syncFmtState],
  );

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
      setActiveSection(null);
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
  }, [mode, paperReady, paperHtml, reportGeometry, onPaperHeight]);

  useEffect(() => {
    if (mode === "html" && paperReady) reportGeometry();
  }, [annotations, mode, paperReady, reportGeometry]);

  useEffect(() => {
    if (mode !== "text" || !textEditorRef.current) return;
    const el = textEditorRef.current;
    if (document.activeElement === el) return;
    if (el.innerText !== (paperText || "")) {
      el.innerText = paperText || "";
    }
  }, [mode, paperText]);

  // Annotation highlight (separate from block active)
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    ensureEditorStyles(doc);
    doc.querySelectorAll(`[${HL_ATTR}]`).forEach((el) => el.removeAttribute(HL_ATTR));
    if (!paperReady || !focusedId) return;
    const anchor = localAnchors[focusedId];
    const sel = anchor?.targetSelector;
    const target = sel ? doc.querySelector<HTMLElement>(sel) : null;
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
    ensureEditorStyles(doc);

    requestAnimationFrame(() => {
      fitIframeContentToA4(doc, iframe);
      const canEdit = editableRef.current;

      // Never edit whole body — blocks only
      doc.body.contentEditable = "false";
      doc.body.style.outline = "none";

      const blocks = discoverBlocks(doc);
      for (const block of blocks) {
        block.setAttribute(BLOCK_ATTR, "1");
        block.tabIndex = -1;
        if (canEdit) block.contentEditable = "false";
      }

      const setActiveFromEvent = (target: EventTarget | null) => {
        const block = blockFromNode(target as Node | null);
        if (!block) return;
        activateBlock(doc, block, canEdit);
        const section = (block.getAttribute("data-section") || "other").toLowerCase();
        setActiveSection(section);
        syncFmtState();
      };

      const onFocusIn = (e: FocusEvent) => setActiveFromEvent(e.target);
      const onPointerDown = (e: PointerEvent) => setActiveFromEvent(e.target);
      const onSelectionChange = () => {
        const sel = doc.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const block = blockFromNode(sel.anchorNode);
        if (block && !block.hasAttribute(BLOCK_ACTIVE)) {
          activateBlock(doc, block, canEdit);
          setActiveSection((block.getAttribute("data-section") || "other").toLowerCase());
        }
        syncFmtState();
      };
      const onInput = () => {
        onTextChangeRef.current?.(doc.body?.innerText || "");
        reportGeometry();
        syncFmtState();
      };

      doc.addEventListener("focusin", onFocusIn);
      doc.addEventListener("pointerdown", onPointerDown);
      doc.addEventListener("selectionchange", onSelectionChange);
      if (canEdit) doc.addEventListener("input", onInput);

      inputCleanupRef.current = () => {
        doc.removeEventListener("focusin", onFocusIn);
        doc.removeEventListener("pointerdown", onPointerDown);
        doc.removeEventListener("selectionchange", onSelectionChange);
        doc.removeEventListener("input", onInput);
      };

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
  const gestureBaseRef = useRef(100);

  function bumpZoom(next: number) {
    setZoom(clampZoom(next));
    setZoomHint(true);
    if (zoomHintTimer.current) window.clearTimeout(zoomHintTimer.current);
    zoomHintTimer.current = window.setTimeout(() => setZoomHint(false), 700);
  }

  // Pinch / Ctrl+wheel — only on the paper scroll viewport (not page chrome)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = -e.deltaY;
      const step = Math.abs(delta) > 40 ? 8 : 4;
      bumpZoom(zoomRef.current + (delta > 0 ? step : -step));
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureBaseRef.current = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      const ge = e as Event & { scale?: number };
      e.preventDefault();
      if (typeof ge.scale === "number" && Number.isFinite(ge.scale)) {
        bumpZoom(gestureBaseRef.current * ge.scale);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    el.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart as EventListener);
      el.removeEventListener("gesturechange", onGestureChange as EventListener);
      if (zoomHintTimer.current) window.clearTimeout(zoomHintTimer.current);
    };
  }, []);

  const paperWidthPct = Math.min(100, zoom);
  const showEditorChrome = mode === "html" && paperEditable !== false;
  const sectionKey = sectionLabelKey(activeSection || "other");
  const sectionLabel = activeSection
    ? t(`optimize.workspace.block.${sectionKey}` as Parameters<typeof t>[0])
    : t("optimize.workspace.block.none");

  // silence unused — kept for API compat with parent
  void onFocusAnnotation;
  void onExport;

  return (
    <div className="optimize-ws-paper relative flex min-h-0 flex-1 flex-col items-center pt-0">
      {showEditorChrome && (
        <div className="optimize-ws-editor-toolbar sticky top-0 z-10 mb-2 flex w-full max-w-[560px] items-center gap-1 rounded-xl border border-[#E8ECF4] bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur-sm">
          <span
            className="mr-1 hidden min-w-0 max-w-[7.5rem] truncate rounded-md bg-[#F1F5F9] px-2 py-1 text-[11px] font-semibold text-[#475569] sm:inline"
            title={sectionLabel}
          >
            {sectionLabel}
          </span>
          <div className="flex items-center gap-0.5 border-r border-[#E8ECF4] pr-1.5">
            <ToolbarBtn
              label={t("optimize.workspace.editorBold")}
              active={fmtState.bold}
              disabled={!activeSection}
              onClick={() => runCommand("bold")}
            >
              <BoldIcon className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn
              label={t("optimize.workspace.editorItalic")}
              active={fmtState.italic}
              disabled={!activeSection}
              onClick={() => runCommand("italic")}
            >
              <ItalicIcon className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn
              label={t("optimize.workspace.editorList")}
              disabled={!activeSection}
              onClick={() => runCommand("insertUnorderedList")}
            >
              <ListBulletIcon className="h-4 w-4" />
            </ToolbarBtn>
          </div>
          <div className="flex items-center gap-0.5 border-r border-[#E8ECF4] pr-1.5">
            <ToolbarBtn
              label={t("optimize.workspace.editorUndo")}
              disabled={!activeSection}
              onClick={() => runCommand("undo")}
            >
              <ArrowUturnLeftIcon className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn
              label={t("optimize.workspace.editorRedo")}
              disabled={!activeSection}
              onClick={() => runCommand("redo")}
            >
              <ArrowUturnRightIcon className="h-4 w-4" />
            </ToolbarBtn>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <ToolbarBtn
              label={t("optimize.workspace.zoomOut")}
              onClick={() => bumpZoom(zoomRef.current - 10)}
              disabled={zoom <= ZOOM_MIN}
            >
              <MinusIcon className="h-4 w-4" />
            </ToolbarBtn>
            <button
              type="button"
              className="min-w-[2.75rem] rounded-md px-1 py-1 text-center text-[11px] font-semibold tabular-nums text-[#334155] hover:bg-[#F8FAFC]"
              title={t("optimize.workspace.zoomHint")}
              onClick={() => bumpZoom(100)}
            >
              {zoom}%
            </button>
            <ToolbarBtn
              label={t("optimize.workspace.zoomIn")}
              onClick={() => bumpZoom(zoomRef.current + 10)}
              disabled={zoom >= ZOOM_MAX}
            >
              <PlusIcon className="h-4 w-4" />
            </ToolbarBtn>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="optimize-ws-paper-scroll relative w-full max-w-[560px] flex-1 overflow-auto pb-20 pt-0 px-0 sm:px-1"
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
            className="optimize-ws-a4 relative w-full rounded-sm bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.06)]"
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
                  <div className="h-5 w-40 animate-pulse rounded bg-[#E2E8F0]" />
                  <div className="h-3 w-28 animate-pulse rounded bg-[#F1F5F9]" />
                  <div className="mt-4 space-y-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                      <div
                        key={i}
                        className="h-2.5 animate-pulse rounded bg-[#F8FAFC]"
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

function ToolbarBtn({
  label,
  onClick,
  children,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? "bg-[#EEF2FF] text-[#4578FC]"
          : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0f172a]"
      }`}
    >
      {children}
    </button>
  );
}
