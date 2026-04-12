import {
  appendAdminPipelineLog,
  appendAdminPipelineLogs,
  isAdminPipelineCaptureEnabled,
} from "./adminPipelineLogStore";
import type { AdminPipelineLogEntry } from "./adminPipelineLogStore";

const API = "/api";
const AUTH_TOKEN_KEY = "hr_breaker_token";

/** Deep-link from email: `/optimize?resume=…` — token stored before redirect to login if needed. */
export const OPTIMIZE_RESUME_QUERY_PARAM = "resume";
export const OPTIMIZE_RESUME_SESSION_KEY = "pitchcv_optimize_resume_token_v1";

export function getStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function parseJsonOrThrow<T>(r: Response): Promise<T> {
  const text = await r.text();
  if (!text.trim()) throw new Error(r.ok ? "Empty response" : r.statusText || "Request failed");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(r.ok ? "Invalid JSON response" : text || r.statusText);
  }
}

export type ExtractNameResponse = { first_name: string | null; last_name: string | null };

export type ExtractResumeSummaryResponse = {
  full_name: string | null;
  specialty: string | null;
  skills: string | null;
};
export type JobPostingOut = {
  title: string;
  company: string;
  requirements: string[];
  keywords: string[];
  description: string;
};
export type FilterResultOut = {
  filter_name: string;
  passed: boolean;
  score: number;
  threshold: number;
  issues: string[];
  suggestions: string[];
};
export type ValidationResultOut = { passed: boolean; results: FilterResultOut[] };
export type ChangeDetailOut = {
  category: string;
  description: string | null;
  items: string[];
};
export type OptimizeResponse = {
  success: boolean;
  pdf_base64: string | null;
  pdf_filename: string | null;
  pending_export_token?: string | null;
  pending_export_expires_at?: string | null;
  validation: ValidationResultOut;
  job: JobPostingOut;
  key_changes?: ChangeDetailOut[] | null;
  error: string | null;
  optimized_resume_text?: string | null;
  schema_json?: string | null;
  /** Public link to read-only saved result (~3 days). */
  snapshot_url?: string | null;
  snapshot_expires_at?: string | null;
};

/** GET /api/optimization-snapshot — same shape as server `OptimizationSnapshotPublicOut`. */
export type OptimizationSnapshotPublic = {
  expires_at: string;
  pdf_filename: string | null;
  pdf_download_available: boolean;
  job: JobPostingOut;
  validation: ValidationResultOut;
  key_changes?: ChangeDetailOut[] | null;
  schema_json?: string | null;
  pre_ats_score?: number | null;
  pre_keyword_score?: number | null;
  post_ats_score?: number | null;
  post_keyword_score?: number | null;
  pending_export_token?: string | null;
  job_url?: string | null;
  optimized_resume_text?: string | null;
};

export function optimizationSnapshotPdfUrl(token: string): string {
  const q = new URLSearchParams({ token });
  return `${API}/optimization-snapshot/pdf?${q.toString()}`;
}

export type OptimizationSnapshotFetchResult =
  | { ok: true; data: OptimizationSnapshotPublic }
  | { ok: false; status: number; detail: string };

export async function fetchOptimizationSnapshotForMe(token: string): Promise<OptimizationSnapshotFetchResult> {
  const q = new URLSearchParams({ token });
  const r = await fetch(`${API}/optimization-snapshot/for-me?${q.toString()}`, {
    headers: authHeaders(),
  });
  const text = await r.text();
  let parsed: unknown = {};
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = {};
    }
  }
  if (!r.ok) {
    const detail =
      typeof (parsed as { detail?: unknown }).detail === "string"
        ? (parsed as { detail: string }).detail
        : r.statusText || "Request failed";
    return { ok: false, status: r.status, detail };
  }
  return { ok: true, data: parsed as OptimizationSnapshotPublic };
}

export async function fetchOptimizationSnapshot(token: string): Promise<OptimizationSnapshotFetchResult> {
  const q = new URLSearchParams({ token });
  const r = await fetch(`${API}/optimization-snapshot?${q.toString()}`);
  const text = await r.text();
  let parsed: unknown = {};
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = {};
    }
  }
  if (!r.ok) {
    const detail =
      typeof (parsed as { detail?: unknown }).detail === "string"
        ? (parsed as { detail: string }).detail
        : r.statusText || "Request failed";
    return { ok: false, status: r.status, detail };
  }
  return { ok: true, data: parsed as OptimizationSnapshotPublic };
}

export type DownloadPendingOptimizePdfResponse = {
  blob: Blob;
  filename: string;
};
export type HistoryItem = {
  filename: string;
  company: string;
  job_title: string;
  timestamp: string;
  first_name: string | null;
  last_name: string | null;
  pre_ats_score?: number | null;
  post_ats_score?: number | null;
  pre_keyword_score?: number | null;
  post_keyword_score?: number | null;
  company_logo_url?: string | null;
  job_url?: string | null;
  source_checksum?: string;
  source_was_pdf?: boolean;
};
export type HistoryResponse = { items: HistoryItem[] };

export function historyOriginalUrl(filename: string): string {
  return `${API}/history/original/${encodeURIComponent(filename)}`;
}

export async function getHistoryOriginalText(filename: string): Promise<string> {
  const r = await fetch(historyOriginalUrl(filename), { headers: authHeaders() });
  if (!r.ok) {
    const data = await r.json().catch(() => ({})) as { detail?: string };
    throw new Error(data.detail || r.statusText);
  }
  return r.text();
}


export async function deleteHistory(filename: string): Promise<void> {
  const r = await fetch(`${API}/history/${encodeURIComponent(filename)}`, { method: "DELETE", headers: authHeaders() });
  if (!r.ok) {
    const data = await r.json().catch(() => ({})) as { detail?: string };
    throw new Error(data.detail || r.statusText);
  }
}
export type SettingsResponse = {
  has_api_key: boolean;
  max_iterations: number;
  output_dir: string;
};

export async function extractName(content: string): Promise<ExtractNameResponse> {
  const r = await fetch(`${API}/resume/extract-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ content }),
  });
  const data = await parseJsonOrThrow<ExtractNameResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function extractResumeSummary(content: string): Promise<ExtractResumeSummaryResponse> {
  const r = await fetch(`${API}/resume/extract-summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ content }),
  });
  const data = await parseJsonOrThrow<ExtractResumeSummaryResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export type ParsePdfResponse = { content: string };

export async function parseResumePdf(file: File): Promise<ParsePdfResponse> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API}/resume/parse-pdf`, { method: "POST", body: form, headers: authHeaders() });
  const data = await parseJsonOrThrow<ParsePdfResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function parseResumeDocx(file: File): Promise<ParsePdfResponse> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API}/resume/parse-docx`, { method: "POST", body: form, headers: authHeaders() });
  const data = await parseJsonOrThrow<ParsePdfResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

/** First page of PDF as PNG (for Optimize step 1 preview). Returns object URL; caller must revoke. */
export async function getResumeThumbnailUrl(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API}/resume/thumbnail`, { method: "POST", body: form, headers: authHeaders() });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(text || r.statusText);
  }
  const blob = await r.blob();
  return URL.createObjectURL(blob);
}

export type RegisterUploadResponse = { filename: string };

export async function registerResumeUpload(file: File): Promise<RegisterUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API}/resume/register-upload`, {
    method: "POST",
    body: form,
    headers: authHeaders(),
  });
  const data = await parseJsonOrThrow<RegisterUploadResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function parseJob(params: { url?: string; text?: string }): Promise<JobPostingOut> {
  const r = await fetch(`${API}/job/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<JobPostingOut & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export type RecommendationItem = {
  category: string;
  labels: string[];
};

export type CallbackBlockerOut = {
  headline: string;
  impact: string;
  action: string;
};

export type AnalyzeResponse = {
  ats_score: number;
  keyword_score: number;
  keyword_threshold: number;
  job?: JobPostingOut | null;
  recommendations?: RecommendationItem[];
  /** LLM-provided rejection risk 0-100 */
  rejection_risk_score?: number | null;
  /** Short headlines derived from callback_blockers (legacy / scan text) */
  critical_issues?: string[];
  /** 1–2 structured reasons: headline + impact + action from LLM */
  callback_blockers?: CallbackBlockerOut[];
  /** One-line explanation for rejection risk */
  risk_summary?: string | null;
  /** LLM-generated tips with headers for recommendations block */
  improvement_tips?: string | null;
  /** Admin-only: server pipeline steps */
  admin_pipeline_log?: AdminPipelineLogEntry[] | null;
};

const OUTPUT_LANGUAGE_KEY = "app_output_language";

/** Preferred language for LLM output (resume text, tips). Default "en". */
export function getOutputLanguage(): string {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(OUTPUT_LANGUAGE_KEY);
  return stored === "ru" ? "ru" : "en";
}

export function setOutputLanguage(lang: "en" | "ru"): void {
  window.localStorage.setItem(OUTPUT_LANGUAGE_KEY, lang);
}

export async function analyze(params: {
  resume_content: string;
  job_text?: string;
  job_url?: string;
  output_language?: string;
}): Promise<AnalyzeResponse> {
  if (isAdminPipelineCaptureEnabled()) {
    appendAdminPipelineLog({
      phase: "client",
      step: "request",
      message: "POST /analyze",
      data: {
        resume_chars: params.resume_content.length,
        job_url: Boolean(params.job_url),
        job_text_chars: params.job_text?.length ?? 0,
        output_language: params.output_language ?? getOutputLanguage(),
      },
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const r = await fetch(`${API}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    const data = await parseJsonOrThrow<AnalyzeResponse & { detail?: string }>(r);
    if (!r.ok) throw new Error(data.detail || r.statusText);
    if (isAdminPipelineCaptureEnabled() && data.admin_pipeline_log?.length) {
      appendAdminPipelineLogs(data.admin_pipeline_log as AdminPipelineLogEntry[]);
    }
    if (isAdminPipelineCaptureEnabled()) {
      appendAdminPipelineLog({
        phase: "client",
        step: "response",
        message: `/analyze OK`,
        data: {
          ats_score: data.ats_score,
          keyword_score: data.keyword_score,
          job_title: data.job?.title ?? null,
          company: data.job?.company ?? null,
        },
      });
    }
    return data;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Analysis timeout. Please try again.");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Landing save → login → claim flow ---
export type LandingPendingResponse = {
  resume_filename: string;
  job_title: string | null;
};

export type LandingClaimResponse = {
  resume_content: string;
  job_text: string | null;
  resume_filename: string;
};

export async function getLandingPending(token: string): Promise<LandingPendingResponse> {
  const r = await fetch(`${API}/landing/pending?token=${encodeURIComponent(token)}`);
  const data = await parseJsonOrThrow<LandingPendingResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function claimLandingPending(token: string): Promise<LandingClaimResponse> {
  const r = await fetch(`${API}/landing/claim?token=${encodeURIComponent(token)}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<LandingClaimResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function optimize(params: {
  resume_content: string;
  job_text?: string;
  job_url?: string;
  max_iterations?: number;
  parallel?: boolean;
  aggressive_tailoring?: boolean;
  pre_ats_score?: number;
  pre_keyword_score?: number;
  source_was_pdf?: boolean;
  output_language?: string;
}): Promise<OptimizeResponse> {
  if (isAdminPipelineCaptureEnabled()) {
    appendAdminPipelineLog({
      phase: "client",
      step: "request",
      message: "POST /optimize (non-SSE fallback)",
      data: {
        resume_chars: params.resume_content.length,
        job_url: Boolean(params.job_url),
        parallel: params.parallel,
      },
    });
  }
  const r = await fetch(`${API}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<OptimizeResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || "Optimize failed");
  if (isAdminPipelineCaptureEnabled()) {
    appendAdminPipelineLog({
      phase: "client",
      step: "response",
      message: "/optimize response",
      data: {
        success: data.success,
        validation_passed: data.validation?.passed,
        error: data.error,
        has_pdf: Boolean(data.pdf_base64),
      },
    });
  }
  return data;
}

export async function downloadPendingOptimizePdf(token: string): Promise<DownloadPendingOptimizePdfResponse> {
  const r = await fetch(`${API}/optimize/pending-export/${encodeURIComponent(token)}`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const parsed = await parseJsonOrThrow<{ detail?: string }>(r);
      detail = parsed.detail || detail;
    } catch {
      const text = await r.text().catch(() => "");
      detail = text || detail;
    }
    throw new Error(detail || "Could not download PDF");
  }
  const blob = await r.blob();
  const cd = r.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i);
  const rawName = (m?.[1] || m?.[2] || "").trim();
  const filename = rawName ? decodeURIComponent(rawName) : "optimized_resume.pdf";
  return { blob, filename };
}

/** Optimize with real progress via SSE. onProgress(percent, message) is called for each event. */
export async function optimizeStream(
  params: {
    resume_content: string;
    job_text?: string;
    job_url?: string;
    max_iterations?: number;
    parallel?: boolean;
    aggressive_tailoring?: boolean;
    pre_ats_score?: number;
    pre_keyword_score?: number;
    source_was_pdf?: boolean;
    output_language?: string;
  },
  onProgress: (percent: number, message: string) => void
): Promise<OptimizeResponse> {
  if (isAdminPipelineCaptureEnabled()) {
    appendAdminPipelineLog({
      phase: "client",
      step: "request",
      message: "POST /optimize/stream (SSE)",
      data: {
        resume_chars: params.resume_content.length,
        job_url: Boolean(params.job_url),
        parallel: params.parallel,
      },
    });
  }
  const r = await fetch(`${API}/optimize/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const text = await r.text();
    let detail = text;
    try {
      const j = JSON.parse(text) as { detail?: string };
      detail = j.detail ?? text;
    } catch {
      // ignore
    }
    throw new Error(detail || "Optimize failed");
  }
  const reader = r.body?.getReader();
  if (!reader) throw new Error("No response body");
  const dec = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const payload = JSON.parse(line.slice(6)) as {
            percent?: number;
            message?: string;
            result?: OptimizeResponse;
            error?: string;
            log?: AdminPipelineLogEntry;
          };
          if (isAdminPipelineCaptureEnabled() && payload.log && typeof payload.log.message === "string") {
            appendAdminPipelineLogs([payload.log as AdminPipelineLogEntry]);
          }
          if (payload.percent != null && payload.message != null) {
            onProgress(payload.percent, payload.message);
            if (isAdminPipelineCaptureEnabled()) {
              appendAdminPipelineLog({
                phase: "optimize",
                step: "sse_progress",
                message: `${payload.percent}% — ${payload.message}`,
              });
            }
          }
          if (payload.result != null) {
            if (isAdminPipelineCaptureEnabled()) {
              appendAdminPipelineLog({
                phase: "client",
                step: "sse_done",
                message: "SSE stream finished with result",
                data: {
                  success: payload.result.success,
                  validation_passed: payload.result.validation?.passed,
                  has_pdf: Boolean(payload.result.pdf_base64),
                  error: payload.result.error,
                  filters:
                    payload.result.validation?.results?.map((x) => ({
                      name: x.filter_name,
                      pass: x.passed,
                      score: x.score,
                    })) ?? [],
                },
              });
            }
            return payload.result;
          }
          if (payload.error != null) {
            if (isAdminPipelineCaptureEnabled()) {
              appendAdminPipelineLog({
                phase: "optimize",
                step: "sse_error",
                message: payload.error,
              });
            }
            throw new Error(payload.error);
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue; // skip malformed JSON line
          throw e;
        }
      }
    }
  }
  throw new Error("Stream ended without result");
}

export async function getHistory(): Promise<HistoryResponse> {
  const r = await fetch(`${API}/history`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<HistoryResponse>(r);
  if (!r.ok) throw new Error((data as { detail?: string }).detail || r.statusText);
  return data;
}

export function downloadUrl(filename: string, token?: string | null): string {
  const base = `${API}/history/download/${encodeURIComponent(filename)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/** Open PDF in browser (inline), not download */
export function historyOpenUrl(filename: string, token?: string | null): string {
  const base = `${API}/history/open/${encodeURIComponent(filename)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export function historyThumbnailUrl(filename: string, token?: string | null): string {
  const base = `${API}/history/thumbnail/${encodeURIComponent(filename)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export async function getSettings(): Promise<SettingsResponse> {
  const r = await fetch(`${API}/settings`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<SettingsResponse>(r);
  if (!r.ok) throw new Error((data as { detail?: string }).detail || r.statusText);
  return data;
}

// --- Auth ---
export type Readiness = {
  score: number;
  stage: string;
  progress_to_next: number;
  streak_days: number;
};
export type Subscription = {
  plan: string; // free | trial | monthly
  status: string; // free | trial | active | canceled
  current_period_end: string | null;
  free_analyses_count: number;
  /** Completed optimizes on free plan (backend caps free auto-improve) */
  free_optimize_count?: number;
};
export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  readiness?: Readiness | null;
  subscription?: Subscription | null;
  partner_program_access?: boolean;
};
export type LoginResponse = { access_token: string; user: AuthUser };

export async function login(
  email: string,
  password: string,
  referral?: { code?: string | null; source_url?: string | null }
): Promise<LoginResponse> {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      referral_code: referral?.code ?? undefined,
      referral_source_url: referral?.source_url ?? undefined,
    }),
  });
  const data = await parseJsonOrThrow<LoginResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function register(
  email: string,
  password: string,
  referral?: { code?: string | null; source_url?: string | null }
): Promise<LoginResponse> {
  const r = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      referral_code: referral?.code ?? undefined,
      referral_source_url: referral?.source_url ?? undefined,
    }),
  });
  const data = await parseJsonOrThrow<LoginResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function getMe(): Promise<AuthUser | null> {
  const r = await fetch(`${API}/auth/me`, { headers: authHeaders() });
  if (r.status === 401) return null;
  const data = await parseJsonOrThrow<AuthUser & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

/** Open Google OAuth in current window (user will be redirected to Google, then back to /auth/callback). */
export function getGoogleLoginUrl(redirectUri?: string): string {
  if (!redirectUri) return `${API}/auth/google`;
  return `${API}/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri?: string,
  referral?: { code?: string | null; source_url?: string | null }
): Promise<LoginResponse> {
  const r = await fetch(`${API}/auth/google/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      code,
      redirect_uri: redirectUri,
      referral_code: referral?.code ?? undefined,
      referral_source_url: referral?.source_url ?? undefined,
    }),
  });
  const data = await parseJsonOrThrow<LoginResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

// --- Payments (Stripe Checkout) ---
export type CreateCheckoutResponse = { url: string };

export async function createCheckoutSession(params: {
  price_key: "trial" | "monthly";
  success_url: string;
  cancel_url: string;
}): Promise<CreateCheckoutResponse> {
  const r = await fetch(`${API}/payments/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<CreateCheckoutResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function createBillingPortalSession(params: {
  return_url: string;
}): Promise<CreateCheckoutResponse> {
  const r = await fetch(`${API}/payments/create-portal-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<CreateCheckoutResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

// --- Vacancy search (Adzuna proxy) ---
export type VacancyCard = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_text?: string | null;
  contract_type?: string | null;
  posted_at?: string | null;
  snippet?: string | null;
  url: string;
  source: string;
};

export type VacancySearchResponse = {
  items: VacancyCard[];
  total: number;
  page: number;
  page_size: number;
};

export type VacancySearchParams = {
  q: string;
  location?: string;
  full_time?: boolean;
  permanent?: boolean;
  salary_min?: number;
  page?: number;
  page_size?: number;
};

export async function searchVacancies(params: VacancySearchParams): Promise<VacancySearchResponse> {
  const sp = new URLSearchParams();
  sp.set("q", params.q.trim());
  if (params.location?.trim()) sp.set("location", params.location.trim());
  if (params.full_time === true) sp.set("full_time", "true");
  if (params.permanent === true) sp.set("permanent", "true");
  if (params.salary_min != null) sp.set("salary_min", String(params.salary_min));
  if (params.page != null) sp.set("page", String(params.page));
  if (params.page_size != null) sp.set("page_size", String(params.page_size));
  const r = await fetch(`${API}/vacancies/search?${sp.toString()}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<VacancySearchResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

// --- Admin (admin panel; backend enforces admin email) ---
export const ADMIN_EMAIL = "marichakgroup@gmail.com";

export function isAdminUser(user: AuthUser | null): boolean {
  return (user?.email?.toLowerCase().trim() ?? "") === ADMIN_EMAIL.toLowerCase();
}

export type AdminStatsResponse = {
  users_count: number;
  resumes_count: number;
  database: string;
};

export type AdminUserOut = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  partner_program_access?: boolean;
  admin_blocked?: boolean;
};

export type AdminJourneyEntry = {
  kind: string;
  at: string;
  title: string;
  detail?: string | null;
  action?: string | null;
  success?: boolean | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  /** Present when kind === "resume": open via admin PDF endpoint */
  pdf_filename?: string | null;
  has_stored_source?: boolean | null;
};

export type AdminFunnelStage = { id: string; label: string; done: boolean };

export type AdminUserReferral = {
  code: string;
  referrer_email: string | null;
  source_url: string | null;
  first_seen_at: string;
  status: string;
};

export type AdminUserDetail = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  admin_blocked: boolean;
  has_google: boolean;
  has_password: boolean;
  partner_program_access: boolean;
  subscription: {
    plan: string;
    status: string;
    current_period_end: string | null;
    free_analyses_count: number;
    free_optimize_count?: number;
  };
  readiness: {
    score: number;
    stage: string;
    progress_to_next: number;
    streak_days: number;
  } | null;
  referral: AdminUserReferral | null;
  stages: AdminFunnelStage[];
  current_stage_summary: string;
  resume_count: number;
  journey: AdminJourneyEntry[];
};

export type AdminUsersResponse = { items: AdminUserOut[]; total: number };

export type AdminConfigResponse = {
  database_configured: boolean;
  jwt_configured: boolean;
  google_oauth_configured: boolean;
  stripe_configured: boolean;
  landing_origins_count: number;
  landing_rate_limit_hours: number;
  landing_pending_ttl_seconds: number;
  max_iterations: number;
  frontend_url: string;
  email_public_base_url: string;
  email_effective_public_base: string;
  adzuna_configured: boolean;
  partner_program_enabled?: boolean;
};

export type AdminActivityItem = {
  filename: string;
  company: string;
  job_title: string;
  created_at: string;
  user_email: string | null;
  pdf_on_disk?: boolean;
  /** uploaded = user upload (uploaded_*); generated = tailored PDF */
  file_kind?: "uploaded" | "generated";
  source_was_pdf?: boolean;
  has_stored_source?: boolean;
};

export type AdminActivityResponse = { items: AdminActivityItem[]; total: number };

export type UnifiedResumeSchema = {
  schema_version: "1.0";
  meta: {
    target_role?: string | null;
    target_locale?: string | null;
    source_checksum?: string | null;
    layout_hints?: Record<string, string>;
  };
  basics: {
    name: string;
    label?: string | null;
    email?: string | null;
    phone?: string | null;
    url?: string | null;
    summary?: string | null;
  };
  work: Array<{
    name: string;
    position: string;
    start_date?: string | null;
    end_date?: string | null;
    highlights: string[];
  }>;
  education: Array<{
    institution: string;
    area?: string | null;
    study_type?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  }>;
  skills: Array<{ name: string; level?: string | null; keywords: string[] }>;
  projects: Array<{ name: string; description?: string | null; highlights: string[] }>;
  certificates: Array<{ name: string; issuer?: string | null; date?: string | null }>;
  languages: Array<{ language: string; fluency?: string | null }>;
  awards: Array<{ title: string; summary?: string | null }>;
  publications: Array<{ name: string; publisher?: string | null; summary?: string | null }>;
};

export type AdminTemplateListItem = {
  id: string;
  name: string;
  source: string;
  supports_photo: boolean;
  supports_columns: boolean;
  pdf_stability_score: number;
  default_css_vars: Record<string, string>;
  recommended: boolean;
};

export type AdminTemplateListResponse = { items: AdminTemplateListItem[] };

function logTemplatesLabStep(step: string, message: string, data?: Record<string, unknown>): void {
  if (!isAdminPipelineCaptureEnabled()) return;
  appendAdminPipelineLog({
    phase: "templates_lab",
    step,
    message,
    ...(data !== undefined ? { data } : {}),
  });
}

function unifiedSchemaQuickStats(schema: UnifiedResumeSchema): Record<string, unknown> {
  return {
    name_chars: (schema.basics?.name || "").length,
    work_n: schema.work?.length ?? 0,
    education_n: schema.education?.length ?? 0,
    skills_n: schema.skills?.length ?? 0,
    projects_n: schema.projects?.length ?? 0,
    certs_n: schema.certificates?.length ?? 0,
  };
}

export type AdminTemplateRenderHtmlResponse = {
  html_body: string;
  full_html: string;
};

export type AdminTemplateRenderPdfResponse = {
  pdf_base64: string;
  page_count: number;
  warnings: string[];
};

export async function getAdminStats(): Promise<AdminStatsResponse> {
  const r = await fetch(`${API}/admin/stats`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminStatsResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function adminExtractResumeSchema(params: {
  resume_content: string;
  target_role?: string;
  target_locale?: string;
}): Promise<UnifiedResumeSchema> {
  logTemplatesLabStep("request", "POST /admin/resume-schema/extract", {
    resume_chars: params.resume_content.length,
    target_role: params.target_role ?? null,
    target_locale: params.target_locale ?? null,
  });
  const r = await fetch(`${API}/admin/resume-schema/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<UnifiedResumeSchema & { detail?: string }>(r);
  if (!r.ok) {
    logTemplatesLabStep("error", String(data.detail || r.statusText), { status: r.status });
    throw new Error(data.detail || r.statusText);
  }
  const out = data as UnifiedResumeSchema;
  logTemplatesLabStep("response", "Resume text → UnifiedResumeSchema (LLM) OK", unifiedSchemaQuickStats(out));
  return out;
}

export async function adminExtractResumeSchemaFromFile(params: {
  file: File;
  target_role?: string;
  target_locale?: string;
}): Promise<UnifiedResumeSchema> {
  logTemplatesLabStep("request", "POST /admin/resume-schema/extract-file", {
    filename: params.file.name,
    file_bytes: params.file.size,
    target_role: params.target_role ?? null,
    target_locale: params.target_locale ?? null,
  });
  const form = new FormData();
  form.append("file", params.file);
  if (params.target_role) form.append("target_role", params.target_role);
  if (params.target_locale) form.append("target_locale", params.target_locale);
  const r = await fetch(`${API}/admin/resume-schema/extract-file`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  const data = await parseJsonOrThrow<UnifiedResumeSchema & { detail?: string }>(r);
  if (!r.ok) {
    logTemplatesLabStep("error", String(data.detail || r.statusText), { status: r.status });
    throw new Error(data.detail || r.statusText);
  }
  const out = data as UnifiedResumeSchema;
  logTemplatesLabStep("response", "Resume file → text → UnifiedResumeSchema (LLM) OK", unifiedSchemaQuickStats(out));
  return out;
}

export async function getTemplates(): Promise<AdminTemplateListResponse> {
  const r = await fetch(`${API}/templates`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminTemplateListResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function renderTemplatePdf(params: {
  template_id: string;
  schema: UnifiedResumeSchema;
  signal?: AbortSignal;
}): Promise<AdminTemplateRenderPdfResponse> {
  const { signal, ...body } = params;
  const r = await fetch(`${API}/templates/render-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  const data = await parseJsonOrThrow<AdminTemplateRenderPdfResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function getAdminTemplates(): Promise<AdminTemplateListResponse> {
  logTemplatesLabStep("request", "GET /admin/templates");
  const r = await fetch(`${API}/admin/templates`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminTemplateListResponse & { detail?: string }>(r);
  if (!r.ok) {
    logTemplatesLabStep("error", String(data.detail || r.statusText), { status: r.status });
    throw new Error(data.detail || r.statusText);
  }
  logTemplatesLabStep("response", "Templates list OK", {
    count: data.items.length,
    sample_ids: data.items.slice(0, 12).map((x) => x.id),
  });
  return data;
}

export async function adminRenderTemplateHtml(params: {
  template_id: string;
  schema: UnifiedResumeSchema;
}): Promise<AdminTemplateRenderHtmlResponse> {
  logTemplatesLabStep("request", "POST /admin/templates/render-html", {
    template_id: params.template_id,
    ...unifiedSchemaQuickStats(params.schema),
  });
  const r = await fetch(`${API}/admin/templates/render-html`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<AdminTemplateRenderHtmlResponse & { detail?: string }>(r);
  if (!r.ok) {
    logTemplatesLabStep("error", String(data.detail || r.statusText), { status: r.status, template_id: params.template_id });
    throw new Error(data.detail || r.statusText);
  }
  logTemplatesLabStep("response", "Template HTML render OK", {
    template_id: params.template_id,
    html_body_chars: data.html_body.length,
    full_html_chars: data.full_html.length,
  });
  return data;
}

export async function adminRenderTemplatePdf(params: {
  template_id: string;
  schema: UnifiedResumeSchema;
  signal?: AbortSignal;
}): Promise<AdminTemplateRenderPdfResponse> {
  const { signal, ...body } = params;
  logTemplatesLabStep("request", "POST /admin/templates/render-pdf", {
    template_id: body.template_id,
    ...unifiedSchemaQuickStats(body.schema),
  });
  let r: Response;
  try {
    r = await fetch(`${API}/admin/templates/render-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      logTemplatesLabStep("aborted", "render-pdf aborted (client)", { template_id: body.template_id });
    } else if (isAdminPipelineCaptureEnabled()) {
      logTemplatesLabStep("error", e instanceof Error ? e.message : String(e), { template_id: body.template_id });
    }
    throw e;
  }
  const data = await parseJsonOrThrow<AdminTemplateRenderPdfResponse & { detail?: string }>(r);
  if (!r.ok) {
    logTemplatesLabStep("error", String(data.detail || r.statusText), {
      status: r.status,
      template_id: body.template_id,
    });
    throw new Error(data.detail || r.statusText);
  }
  logTemplatesLabStep("response", "Template PDF render OK (WeasyPrint)", {
    template_id: body.template_id,
    page_count: data.page_count,
    warnings_n: data.warnings?.length ?? 0,
    pdf_b64_len: data.pdf_base64.length,
  });
  return data;
}

export async function getAdminUsers(limit: number, offset: number): Promise<AdminUsersResponse> {
  const sp = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const r = await fetch(`${API}/admin/users?${sp}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminUsersResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function getAdminConfig(): Promise<AdminConfigResponse> {
  const r = await fetch(`${API}/admin/config`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminConfigResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

/** Server segment id: successful optimize in window, still no paid/trial subscription. */
export const ADMIN_EMAIL_SEGMENT_OPTIMIZED_UNPAID = "optimized_unpaid_recent";

export type AdminEmailControl = {
  winback_auto_enabled: boolean;
  winback_delay_min_minutes: number;
  winback_delay_max_minutes: number;
  resend_configured: boolean;
  resend_from_configured: boolean;
  pending_queue_count: number;
  resend_template_reminder_configured: boolean;
  resend_template_short_nudge_configured: boolean;
  /** Published template id/alias from Resend (stored in DB). */
  resend_template_reminder_no_download: string;
  resend_template_short_nudge: string;
};

export async function getAdminEmailControl(): Promise<AdminEmailControl> {
  const r = await fetch(`${API}/admin/email/control`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminEmailControl & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function patchAdminEmailControl(body: {
  winback_auto_enabled?: boolean;
  winback_delay_min_minutes?: number;
  winback_delay_max_minutes?: number;
  resend_template_reminder_no_download?: string;
  resend_template_short_nudge?: string;
}): Promise<AdminEmailControl> {
  const r = await fetch(`${API}/admin/email/control`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<AdminEmailControl & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function postAdminEmailQueueProcess(limit?: number): Promise<Record<string, unknown>> {
  const sp = limit != null ? `?limit=${limit}` : "";
  const r = await fetch(`${API}/admin/email/queue/process${sp}`, {
    method: "POST",
    headers: authHeaders(),
  });
  const data = await parseJsonOrThrow<Record<string, unknown> & { detail?: string }>(r);
  if (!r.ok) throw new Error(String(data.detail || r.statusText));
  return data;
}

export type AdminResendTemplate = {
  id: string;
  name: string;
};

export async function getAdminResendTemplates(): Promise<AdminResendTemplate[]> {
  const r = await fetch(`${API}/admin/email/resend/templates`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<(AdminResendTemplate & { detail?: string })[]>(r);
  if (!r.ok) {
    const detail = Array.isArray(data) ? undefined : (data as { detail?: string }).detail;
    throw new Error(detail || r.statusText);
  }
  return data as AdminResendTemplate[];
}

export type AdminEmailSendOneResult = {
  ok: boolean;
  email: string;
  resend_template_id: string;
  error?: string | null;
};

export async function postAdminEmailSendOne(body: {
  email: string;
  resend_template_id: string;
}): Promise<AdminEmailSendOneResult> {
  const r = await fetch(`${API}/admin/email/send-one`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<AdminEmailSendOneResult & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export type AdminEmailCtaInfo = {
  email: string;
  user_found: boolean;
  has_valid_snapshot: boolean;
  snapshot_expires_at: string | null;
  has_saved_pdf: boolean;
};

export async function getAdminEmailCtaInfo(email: string): Promise<AdminEmailCtaInfo> {
  const q = encodeURIComponent(email.trim());
  const r = await fetch(`${API}/admin/email/cta-info?email=${q}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminEmailCtaInfo & { detail?: string }>(r);
  if (!r.ok) throw new Error((data as { detail?: string }).detail || r.statusText);
  return data;
}

export type AdminEmailSegmentPreview = {
  segment_id: string;
  days: number;
  recipients_count: number;
  sample_emails: string[];
};

export async function postAdminEmailSegmentPreview(body: {
  segment_id: string;
  days?: number;
  sample_limit?: number;
}): Promise<AdminEmailSegmentPreview> {
  const r = await fetch(`${API}/admin/email/segment/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<AdminEmailSegmentPreview & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export type AdminEmailSegmentSendResult = {
  segment_id: string;
  template_id: string;
  dry_run: boolean;
  attempted: number;
  sent: number;
  failed: number;
  errors_sample: string[];
};

export async function postAdminEmailSegmentSend(body: {
  segment_id: string;
  template_id: string;
  dry_run: boolean;
  days?: number;
  limit?: number;
}): Promise<AdminEmailSegmentSendResult> {
  const r = await fetch(`${API}/admin/email/segment/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<AdminEmailSegmentSendResult & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function getAdminActivity(limit: number, offset: number): Promise<AdminActivityResponse> {
  const sp = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const r = await fetch(`${API}/admin/activity?${sp}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminActivityResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

/** Open PDF in a new tab (admin auth). */
export async function openAdminPdfInNewTab(filename: string): Promise<void> {
  const r = await fetch(`${API}/admin/pdf/${encodeURIComponent(filename)}`, { headers: authHeaders() });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    URL.revokeObjectURL(url);
    throw new Error("Popup blocked");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** Download stored resume source text (.txt) for a history filename (admin). */
export async function downloadAdminResumeSource(filename: string): Promise<void> {
  const r = await fetch(`${API}/admin/resume-source/${encodeURIComponent(filename)}`, { headers: authHeaders() });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `source_${filename.replace(/\.pdf$/i, "")}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type AdminUsageAuditItem = {
  id: string;
  user_email: string | null;
  action: string;
  model: string | null;
  success: boolean;
  error_message: string | null;
  input_tokens: number;
  output_tokens: number;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminUsageAuditResponse = { items: AdminUsageAuditItem[] };

export async function getAdminUsageAudit(limit?: number): Promise<AdminUsageAuditResponse> {
  const sp = limit != null ? `?limit=${limit}` : "";
  const r = await fetch(`${API}/admin/usage-audit${sp}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminUsageAuditResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function patchAdminUserPartnerAccess(
  userId: string,
  partner_program_access: boolean
): Promise<{ ok: boolean }> {
  const r = await fetch(`${API}/admin/users/${encodeURIComponent(userId)}/partner-access`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ partner_program_access }),
  });
  const data = await parseJsonOrThrow<{ ok?: boolean; detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return { ok: true };
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  const r = await fetch(`${API}/admin/users/${encodeURIComponent(userId)}/detail`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminUserDetail & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function patchAdminUserBlocked(userId: string, admin_blocked: boolean): Promise<{ ok: boolean }> {
  const r = await fetch(`${API}/admin/users/${encodeURIComponent(userId)}/blocked`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ admin_blocked }),
  });
  const data = await parseJsonOrThrow<{ ok?: boolean; detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return { ok: !!data.ok };
}

export async function patchAdminUserSubscription(
  userId: string,
  body: { subscription_status?: string; subscription_plan?: string; current_period_end?: string | null }
): Promise<{ ok: boolean }> {
  const r = await fetch(`${API}/admin/users/${encodeURIComponent(userId)}/subscription`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<{ ok?: boolean; detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return { ok: !!data.ok };
}

export async function deleteAdminUser(userId: string): Promise<{ ok: boolean }> {
  const r = await fetch(`${API}/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await parseJsonOrThrow<{ ok?: boolean; detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return { ok: !!data.ok };
}

/** Admin review moderation (landing reviews); requires DATABASE_URL on server. */
export type AdminReviewRow = {
  id: string;
  author_name: string;
  author_email: string;
  author_role?: string | null;
  country?: string | null;
  rating: number;
  would_recommend: boolean;
  title: string;
  body: string;
  feature_tag?: string | null;
  source?: string;
  verified: boolean;
  pinned: boolean;
  consent_to_publish: boolean;
  status: string;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  admin_notes?: string | null;
  helpful_count?: number;
  language?: string | null;
  submitter_ip?: string | null;
};

export type AdminReviewsListResponse = { items: AdminReviewRow[]; total: number };

export async function getAdminReviews(params: {
  limit: number;
  offset: number;
  status?: string;
  rating?: number;
}): Promise<AdminReviewsListResponse> {
  const sp = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.status) sp.set("status", params.status);
  if (params.rating != null) sp.set("rating", String(params.rating));
  const r = await fetch(`${API}/reviews?${sp}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminReviewsListResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function patchAdminReview(
  reviewId: string,
  body: Partial<{
    status: string;
    verified: boolean;
    pinned: boolean;
    title: string;
    body: string;
    admin_notes: string | null;
  }>
): Promise<AdminReviewRow> {
  const r = await fetch(`${API}/reviews/${encodeURIComponent(reviewId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<AdminReviewRow & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data as AdminReviewRow;
}

export async function downloadAdminReviewsCsv(filters: { status?: string; rating?: number }): Promise<Blob> {
  const sp = new URLSearchParams();
  if (filters.status) sp.set("status", filters.status);
  if (filters.rating != null) sp.set("rating", String(filters.rating));
  const q = sp.toString();
  const r = await fetch(`${API}/reviews/export.csv${q ? `?${q}` : ""}`, { headers: authHeaders() });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(text || r.statusText);
  }
  return r.blob();
}

// --- Partner ---
export type PartnerCommissionItem = {
  invited_email: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  created_at: string;
  reason: string | null;
};

export type PartnerMeResponse = {
  referral_link: string;
  payout_threshold_cents: number;
  eligible_cents: number;
  paid_cents: number;
  eligible_count: number;
  pending_count: number;
  paid_count: number;
  rejected_count: number;
  items: PartnerCommissionItem[];
};

export type PartnerTermsResponse = { items: string[] };
export type PartnerLinkResponse = { code: string; referral_link: string };

export async function getPartnerMe(): Promise<PartnerMeResponse> {
  const r = await fetch(`${API}/partner/me`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<PartnerMeResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function createPartnerLink(): Promise<PartnerLinkResponse> {
  const r = await fetch(`${API}/partner/link`, { method: "POST", headers: authHeaders() });
  const data = await parseJsonOrThrow<PartnerLinkResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function getPartnerTerms(): Promise<PartnerTermsResponse> {
  const r = await fetch(`${API}/partner/terms`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<PartnerTermsResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export type AdminReferralChainItem = {
  id: string;
  first_seen_at: string;
  expires_at: string;
  attribution_status: string;
  attribution_reason: string | null;
  code: string;
  referrer_email: string | null;
  invited_email: string | null;
  commission_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  commission_status: string | null;
  commission_reason: string | null;
};

export type AdminReferralChainsResponse = { items: AdminReferralChainItem[] };

export type AdminReferralEventItem = {
  id: string;
  event_type: string;
  stripe_event_id: string | null;
  user_email: string | null;
  referrer_email: string | null;
  invited_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminReferralEventsResponse = { items: AdminReferralEventItem[] };

export async function getAdminReferralChains(limit?: number): Promise<AdminReferralChainsResponse> {
  const sp = limit != null ? `?limit=${limit}` : "";
  const r = await fetch(`${API}/admin/referrals/chains${sp}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminReferralChainsResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function getAdminReferralEvents(limit?: number): Promise<AdminReferralEventsResponse> {
  const sp = limit != null ? `?limit=${limit}` : "";
  const r = await fetch(`${API}/admin/referrals/events${sp}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminReferralEventsResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

async function adminReferralAction(
  action: "approve" | "reject" | "hold" | "block",
  commission_id: string,
  reason?: string
): Promise<void> {
  const r = await fetch(`${API}/admin/referrals/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ commission_id, reason }),
  });
  if (!r.ok) {
    const data = await parseJsonOrThrow<{ detail?: string }>(r);
    throw new Error(data.detail || r.statusText);
  }
}

export function adminReferralApprove(commission_id: string, reason?: string): Promise<void> {
  return adminReferralAction("approve", commission_id, reason);
}
export function adminReferralReject(commission_id: string, reason?: string): Promise<void> {
  return adminReferralAction("reject", commission_id, reason);
}
export function adminReferralHold(commission_id: string, reason?: string): Promise<void> {
  return adminReferralAction("hold", commission_id, reason);
}
export function adminReferralBlock(commission_id: string, reason?: string): Promise<void> {
  return adminReferralAction("block", commission_id, reason);
}
