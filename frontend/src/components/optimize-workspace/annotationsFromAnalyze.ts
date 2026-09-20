import type {
  AnalyzeResponse,
  ChangeDetailOut,
  RecommendationItem,
  WorkspaceAnnotation,
} from "../../api";

const SECTION_Y: Record<string, number> = {
  header: 0.1,
  summary: 0.22,
  experience: 0.48,
  skills: 0.72,
  education: 0.85,
  other: 0.4,
};

function categorySection(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("keyword") || c.includes("requirement") || c.includes("skill")) return "skills";
  if (c.includes("writing") || c.includes("impact") || c.includes("experience") || c.includes("bullet"))
    return "experience";
  if (c.includes("summary") || c.includes("profile")) return "summary";
  if (c.includes("structure") || c.includes("format")) return "other";
  if (c.includes("education")) return "education";
  return "other";
}

/** After improve: left-rail cards from optimizer key_changes (what got better). */
export function annotationsFromKeyChanges(
  keyChanges: ChangeDetailOut[] | undefined | null,
  maxN = 6,
): WorkspaceAnnotation[] {
  const out: WorkspaceAnnotation[] = [];
  let n = 1;
  for (const change of keyChanges || []) {
    const title = (change.category || "").trim();
    if (!title) continue;
    const desc = (change.description || "").trim();
    const items = (change.items || []).map((x) => (x || "").trim()).filter(Boolean);
    const body = desc || (items.length ? items.slice(0, 3).join("; ") : "Applied to your resume.");
    const section = categorySection(title);
    out.push({
      id: `improved-${n++}`,
      severity: "positive",
      title: title.slice(0, 72),
      body: body.slice(0, 220),
      section,
      anchor_y: SECTION_Y[section] ?? 0.4,
    });
    if (out.length >= maxN) break;
  }
  return out;
}

/** Build left-rail cards from recommendations / blockers when API annotations are empty. */
export function annotationsFromRecommendations(
  recommendations: RecommendationItem[] | undefined | null,
  callbackBlockers?: AnalyzeResponse["callback_blockers"],
  maxN = 5,
): WorkspaceAnnotation[] {
  const out: WorkspaceAnnotation[] = [];
  let n = 1;

  for (const b of callbackBlockers || []) {
    const title = (b.headline || "").trim();
    const body = (b.action || b.impact || "").trim();
    if (!title || !body) continue;
    out.push({
      id: `fb-${n++}`,
      severity: "warning",
      title: title.slice(0, 72),
      body: body.slice(0, 220),
      section: "experience",
      anchor_y: SECTION_Y.experience,
    });
    if (out.length >= maxN) return out;
  }

  for (const rec of recommendations || []) {
    const section = categorySection(rec.category || "");
    const sev =
      (rec.category || "").toLowerCase().includes("keyword") ||
      (rec.category || "").toLowerCase().includes("requirement")
        ? "warning"
        : "suggestion";
    for (const tip of rec.tips || []) {
      const title = (tip.title || "").trim();
      const body = (tip.do || "").trim();
      if (!title || !body) continue;
      out.push({
        id: `fb-${n++}`,
        severity: sev,
        title: title.slice(0, 72),
        body: body.slice(0, 220),
        section,
        anchor_y: SECTION_Y[section] ?? 0.4,
      });
      if (out.length >= maxN) return out;
    }
    for (const label of rec.labels || []) {
      const text = (label || "").trim();
      if (!text) continue;
      out.push({
        id: `fb-${n++}`,
        severity: "suggestion",
        title: text.slice(0, 72),
        body: "Add truthful proof for this in Skills or a recent Experience bullet.",
        section: "skills",
        anchor_y: SECTION_Y.skills,
      });
      if (out.length >= maxN) return out;
    }
  }

  return out;
}

export function resolveWorkspaceAnnotations(
  primary: WorkspaceAnnotation[] | undefined | null,
  fallbackSource?: {
    recommendations?: RecommendationItem[] | null;
    callback_blockers?: AnalyzeResponse["callback_blockers"];
  } | null,
): WorkspaceAnnotation[] {
  if (primary?.length) return primary;
  if (!fallbackSource) return [];
  return annotationsFromRecommendations(
    fallbackSource.recommendations,
    fallbackSource.callback_blockers,
  );
}

/** Assessment = tips to apply. Result = what improved (never tip/suggestion leftovers). */
export function resolveResultAnnotations(opts: {
  keyChanges?: ChangeDetailOut[] | null;
  resultAnnotations?: WorkspaceAnnotation[] | null;
}): WorkspaceAnnotation[] {
  const fromChanges = annotationsFromKeyChanges(opts.keyChanges);
  if (fromChanges.length) return fromChanges;
  const positives = (opts.resultAnnotations || []).filter((a) => a.severity === "positive");
  return positives;
}
