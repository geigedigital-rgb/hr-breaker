import type {
  AnalyzeResponse,
  ExtractResumeSummaryResponse,
  JobPostingOut,
  OptimizeResponse,
} from "./api";

/** Client work session for /optimize — survives refresh for TTL. */
export const OPTIMIZE_WORK_SESSION_KEY = "pitchcv_optimize_work_session_v1";
export const OPTIMIZE_WORK_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type OptimizeWorkStage = "assessment" | "result";

export type OptimizeWorkSessionV1 = {
  v: 1;
  savedAt: number;
  stage: OptimizeWorkStage;
  resumeContent: string;
  jobInput: string;
  jobMode: "url" | "text";
  isImproveMode: boolean;
  preScores: AnalyzeResponse | null;
  parsedJob: JobPostingOut | null;
  resumeSourceWasPdf: boolean;
  uploadedFileName: string | null;
  resumeSummaryFromApi: ExtractResumeSummaryResponse | null;
  result: OptimizeResponse | null;
  selectedTemplateId: string;
  photoDataUrl: string | null;
};

function stripHeavyResult(result: OptimizeResponse | null): OptimizeResponse | null {
  if (!result) return null;
  // pdf_base64 can blow localStorage quota; HTML/schema + text are enough to resume UI
  return { ...result, pdf_base64: null };
}

export function clearOptimizeWorkSession(): void {
  try {
    localStorage.removeItem(OPTIMIZE_WORK_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function saveOptimizeWorkSession(
  partial: Omit<OptimizeWorkSessionV1, "v" | "savedAt">,
): void {
  try {
    const stage = partial.stage;
    if (stage !== "assessment" && stage !== "result") return;
    if (!partial.resumeContent.trim()) return;
    if (stage === "assessment" && !partial.preScores) return;
    if (stage === "result" && !partial.result) return;

    const payload: OptimizeWorkSessionV1 = {
      v: 1,
      savedAt: Date.now(),
      stage,
      resumeContent: partial.resumeContent,
      jobInput: partial.jobInput,
      jobMode: partial.jobMode === "url" ? "url" : "text",
      isImproveMode: Boolean(partial.isImproveMode),
      preScores: partial.preScores,
      parsedJob: partial.parsedJob,
      resumeSourceWasPdf: Boolean(partial.resumeSourceWasPdf),
      uploadedFileName: partial.uploadedFileName,
      resumeSummaryFromApi: partial.resumeSummaryFromApi,
      result: stripHeavyResult(partial.result),
      selectedTemplateId: partial.selectedTemplateId || "",
      photoDataUrl: partial.photoDataUrl,
    };
    localStorage.setItem(OPTIMIZE_WORK_SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — drop photo and retry once
    try {
      const lean: OptimizeWorkSessionV1 = {
        v: 1,
        savedAt: Date.now(),
        stage: partial.stage,
        resumeContent: partial.resumeContent,
        jobInput: partial.jobInput,
        jobMode: partial.jobMode === "url" ? "url" : "text",
        isImproveMode: Boolean(partial.isImproveMode),
        preScores: partial.preScores,
        parsedJob: partial.parsedJob,
        resumeSourceWasPdf: Boolean(partial.resumeSourceWasPdf),
        uploadedFileName: partial.uploadedFileName,
        resumeSummaryFromApi: partial.resumeSummaryFromApi,
        result: stripHeavyResult(partial.result),
        selectedTemplateId: partial.selectedTemplateId || "",
        photoDataUrl: null,
      };
      localStorage.setItem(OPTIMIZE_WORK_SESSION_KEY, JSON.stringify(lean));
    } catch {
      /* ignore */
    }
  }
}

export function loadOptimizeWorkSession(
  now = Date.now(),
): OptimizeWorkSessionV1 | null {
  try {
    const raw = localStorage.getItem(OPTIMIZE_WORK_SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as OptimizeWorkSessionV1;
    if (p?.v !== 1 || typeof p.savedAt !== "number") {
      clearOptimizeWorkSession();
      return null;
    }
    if (now - p.savedAt > OPTIMIZE_WORK_SESSION_TTL_MS) {
      clearOptimizeWorkSession();
      return null;
    }
    if (!p.resumeContent?.trim()) {
      clearOptimizeWorkSession();
      return null;
    }
    if (p.stage === "assessment" && !p.preScores) {
      clearOptimizeWorkSession();
      return null;
    }
    if (p.stage === "result" && !p.result) {
      clearOptimizeWorkSession();
      return null;
    }
    if (p.stage !== "assessment" && p.stage !== "result") {
      clearOptimizeWorkSession();
      return null;
    }
    return p;
  } catch {
    clearOptimizeWorkSession();
    return null;
  }
}

/** Call when a new analyze/optimize run starts — discard previous work session. */
export function beginNewOptimizeWork(): void {
  clearOptimizeWorkSession();
}
