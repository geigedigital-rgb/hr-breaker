import type { WorkspaceAnnotation } from "../../api";

/** Per-annotation vertical position on the paper (0–1) + optional DOM target id. */
export type AnnotationAnchorMap = Record<
  string,
  {
    y: number;
    /** data-section or generated mark used for highlight */
    targetSelector?: string;
  }
>;

const DATE_RE =
  /\b(?:0?[1-9]|1[0-2])[/.\-](?:19|20)\d{2}\b|\b(?:19|20)\d{2}[/.\-](?:0?[1-9]|1[0-2])\b|\b(?:19|20)\d{2}\s*[–—\-]\s*(?:(?:0?[1-9]|1[0-2])[/.\-])?(?:19|20)\d{2}\b|\b(?:Present|Heute|aktuell|today)\b/gi;

const DATE_HINT_RE =
  /\b(date|dates|dating|timeline|period|month|year|years|impossible|invalid|future|дат|срок|период)\b/i;

const SIDEBAR_SECTIONS = /^(skills?|languages?|interests?|hobbies|tools|soft[_-]?skills)$/i;
const CONTENT_SECTIONS = /^(experience|education|projects?|work|employment|summary|header|contact|profile)$/i;

function isDateHeavyAnnotation(ann: WorkspaceAnnotation): boolean {
  const raw = `${ann.title}\n${ann.body}`;
  if (DATE_HINT_RE.test(raw)) return true;
  const dates = raw.match(DATE_RE);
  return Boolean(dates && dates.length >= 1);
}

function dateVariants(token: string): string[] {
  const t = token.trim();
  const out = new Set<string>([t]);
  // 06/2026 ↔ 6/2026 ↔ 06.2026 ↔ 2026-06
  const mdy = t.match(/^(0?[1-9]|1[0-2])[/.\-]((?:19|20)\d{2})$/);
  if (mdy) {
    const mm = mdy[1].padStart(2, "0");
    const m = String(Number(mdy[1]));
    const y = mdy[2];
    out.add(`${mm}/${y}`);
    out.add(`${m}/${y}`);
    out.add(`${mm}.${y}`);
    out.add(`${m}.${y}`);
    out.add(`${mm}-${y}`);
    out.add(`${y}-${mm}`);
    out.add(`${y}/${mm}`);
  }
  const ymd = t.match(/^((?:19|20)\d{2})[/.\-](0?[1-9]|1[0-2])$/);
  if (ymd) {
    const y = ymd[1];
    const mm = ymd[2].padStart(2, "0");
    const m = String(Number(ymd[2]));
    out.add(`${mm}/${y}`);
    out.add(`${m}/${y}`);
    out.add(`${y}-${mm}`);
  }
  return [...out];
}

function uniqueNeedles(ann: WorkspaceAnnotation): string[] {
  const raw = `${ann.title}\n${ann.body}`;
  const out: string[] = [];
  const dates = raw.match(DATE_RE) || [];
  for (const d of dates) {
    for (const v of dateVariants(d)) {
      if (v.length >= 4) out.push(v);
    }
  }
  if (isDateHeavyAnnotation(ann) && out.length) {
    return [...new Set(out)].sort((a, b) => b.length - a.length).slice(0, 16);
  }
  // Quoted snippets
  for (const m of raw.matchAll(/[„"']([^„"']{4,48})[„"']/g)) {
    out.push(m[1].trim());
  }
  const words = raw
    .replace(/[^\p{L}\p{N}\s/%.-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 5);
  for (const w of words) {
    if (
      /^(the|and|with|from|that|this|your|have|been|will|should|consider|improve|resume|section|strong|stack|optimize|header|space|consolidate|summary|skills|performance|metrics|impossible|dates|fix)$/i.test(
        w,
      )
    ) {
      continue;
    }
    out.push(w);
  }
  return [...new Set(out)].sort((a, b) => b.length - a.length).slice(0, 12);
}

function sectionKeyOf(el: HTMLElement | null): string {
  if (!el) return "";
  const host = el.closest<HTMLElement>("[data-section]");
  return (host?.getAttribute("data-section") || "").toLowerCase();
}

function sectionScoreBoost(el: HTMLElement, preferDates: boolean): number {
  const key = sectionKeyOf(el);
  if (!key) return 0;
  if (preferDates) {
    if (SIDEBAR_SECTIONS.test(key)) return -0.85;
    if (/experience|education|projects?|work|employment/.test(key)) return 0.45;
  }
  if (CONTENT_SECTIONS.test(key)) return 0.08;
  if (SIDEBAR_SECTIONS.test(key)) return -0.12;
  return 0;
}

function closestBlock(node: Node): HTMLElement | null {
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (el && el !== el.ownerDocument?.body) {
    const tag = el.tagName;
    if (
      el.hasAttribute("data-section") ||
      /^(ARTICLE|SECTION|LI|P|H1|H2|H3|H4|TD|TR|DIV)$/.test(tag)
    ) {
      if (tag === "DIV" && !el.hasAttribute("data-section") && el.children.length > 4) {
        el = el.parentElement;
        continue;
      }
      return el;
    }
    el = el.parentElement;
  }
  return (node as HTMLElement).parentElement;
}

function findTextMatch(
  doc: Document,
  needle: string,
  scope: ParentNode | null,
  preferDates: boolean,
): HTMLElement | null {
  const root = scope || doc.body;
  if (!root || needle.length < 3) return null;
  const lower = needle.toLowerCase();
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let best: { el: HTMLElement; score: number } | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent || "";
    const idx = text.toLowerCase().indexOf(lower);
    if (idx < 0) continue;
    const el = closestBlock(node);
    if (!el) continue;
    if (preferDates && SIDEBAR_SECTIONS.test(sectionKeyOf(el))) continue;
    const score =
      needle.length / Math.max(8, text.length) +
      (el.hasAttribute("data-section") ? 0.05 : 0) +
      sectionScoreBoost(el, preferDates);
    if (!best || score > best.score) best = { el, score };
  }
  return best?.el ?? null;
}

function sectionFallback(doc: Document, section: string, preferDates: boolean): HTMLElement | null {
  const key = (section || "other").toLowerCase();
  if (preferDates && SIDEBAR_SECTIONS.test(key)) {
    return (
      doc.querySelector<HTMLElement>('[data-section="experience"]') ||
      doc.querySelector<HTMLElement>('[data-section="education"]') ||
      doc.querySelector<HTMLElement>('[data-section="projects"]') ||
      null
    );
  }
  const direct = doc.querySelector<HTMLElement>(`[data-section="${CSS.escape(key)}"]`);
  if (direct) return direct;
  if (key === "other" || !key) {
    return (
      doc.querySelector<HTMLElement>('[data-section="experience"]') ||
      doc.querySelector<HTMLElement>('[data-section="summary"]') ||
      null
    );
  }
  return null;
}

/** Find any date-looking text in preferred content sections. */
function findAnyDateBlock(doc: Document): HTMLElement | null {
  const scopes = [
    doc.querySelector('[data-section="experience"]'),
    doc.querySelector('[data-section="education"]'),
    doc.querySelector('[data-section="projects"]'),
    doc.body,
  ].filter(Boolean) as ParentNode[];
  for (const scope of scopes) {
    const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent || "";
      if (!DATE_RE.test(text)) continue;
      DATE_RE.lastIndex = 0;
      const el = closestBlock(node);
      if (!el) continue;
      if (SIDEBAR_SECTIONS.test(sectionKeyOf(el))) continue;
      return el;
    }
  }
  return null;
}

/**
 * Resolve a DOM element for an annotation using:
 * 1) distinctive quotes/dates/tokens from title+body (template-agnostic)
 * 2) optional search scoped to data-section
 * 3) section fallback (never languages/skills for date hints)
 */
export function resolveAnnotationElement(doc: Document, ann: WorkspaceAnnotation): HTMLElement | null {
  const needles = uniqueNeedles(ann);
  const preferDates = isDateHeavyAnnotation(ann);
  const sectionEl =
    ann.section && !(preferDates && SIDEBAR_SECTIONS.test(ann.section))
      ? doc.querySelector<HTMLElement>(`[data-section="${CSS.escape(ann.section)}"]`)
      : null;

  for (const needle of needles) {
    const inSection = sectionEl ? findTextMatch(doc, needle, sectionEl, preferDates) : null;
    if (inSection) return inSection;
  }
  for (const needle of needles) {
    const anywhere = findTextMatch(doc, needle, doc.body, preferDates);
    if (anywhere) return anywhere;
  }
  if (preferDates) {
    const anyDate = findAnyDateBlock(doc);
    if (anyDate) return anyDate;
  }
  return sectionFallback(doc, ann.section, preferDates);
}

export function measureAnnotationAnchors(
  doc: Document,
  paperEl: HTMLElement,
  annotations: WorkspaceAnnotation[],
): AnnotationAnchorMap {
  const paperRect = paperEl.getBoundingClientRect();
  const h = paperRect.height || 1;
  const map: AnnotationAnchorMap = {};
  const used = new WeakSet<HTMLElement>();

  for (const ann of annotations) {
    let el = resolveAnnotationElement(doc, ann);
    if (el && used.has(el) && el.hasAttribute("data-section")) {
      const preferDates = isDateHeavyAnnotation(ann);
      const alt = uniqueNeedles(ann)
        .map((n) => findTextMatch(doc, n, doc.body, preferDates))
        .find((x) => x && !used.has(x));
      if (alt) el = alt;
    }
    if (!el) {
      const y = Math.max(0.05, Math.min(0.95, ann.anchor_y || 0.4));
      map[ann.id] = { y };
      continue;
    }
    used.add(el);
    const mark = `ws-ann-${ann.id}`;
    el.setAttribute("data-ws-ann", mark);
    const r = el.getBoundingClientRect();
    const mid = (r.top - paperRect.top + r.height / 2) / h;
    map[ann.id] = {
      y: Math.max(0.04, Math.min(0.96, mid)),
      targetSelector: `[data-ws-ann="${mark}"]`,
    };
  }
  return map;
}

export function resolveY(
  ann: WorkspaceAnnotation,
  anchors?: AnnotationAnchorMap | null,
): number {
  const a = anchors?.[ann.id];
  if (a && Number.isFinite(a.y)) return Math.max(0.04, Math.min(0.96, a.y));
  return Math.max(0.05, Math.min(0.95, ann.anchor_y || 0.4));
}

export function toneDot(sev: string): string {
  if (sev === "positive") return "#10B981";
  if (sev === "warning") return "#F59E0B";
  return "#0EA5E9";
}
