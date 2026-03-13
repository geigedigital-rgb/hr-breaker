const API = "/api";
const AUTH_TOKEN_KEY = "hr_breaker_token";

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
  validation: ValidationResultOut;
  job: JobPostingOut;
  key_changes?: ChangeDetailOut[] | null;
  error: string | null;
  optimized_resume_text?: string | null;
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

export type AnalyzeResponse = {
  ats_score: number;
  keyword_score: number;
  keyword_threshold: number;
  job?: JobPostingOut | null;
  recommendations?: RecommendationItem[];
  /** Independent LLM breakdown 0-100 */
  skills_score?: number | null;
  experience_score?: number | null;
  portfolio_score?: number | null;
  /** LLM-generated tips with headers for recommendations block */
  improvement_tips?: string | null;
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
  const r = await fetch(`${API}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<AnalyzeResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
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
  const r = await fetch(`${API}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<OptimizeResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || "Optimize failed");
  return data;
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
          };
          if (payload.percent != null && payload.message != null) {
            onProgress(payload.percent, payload.message);
          }
          if (payload.result != null) {
            return payload.result;
          }
          if (payload.error != null) {
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
};
export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  readiness?: Readiness | null;
  subscription?: Subscription | null;
};
export type LoginResponse = { access_token: string; user: AuthUser };

export async function login(email: string, password: string): Promise<LoginResponse> {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJsonOrThrow<LoginResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function register(email: string, password: string): Promise<LoginResponse> {
  const r = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
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

export async function exchangeGoogleCode(code: string, redirectUri?: string): Promise<LoginResponse> {
  const r = await fetch(`${API}/auth/google/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
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
};

export type AdminUsersResponse = { items: AdminUserOut[] };

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
  adzuna_configured: boolean;
};

export type AdminActivityItem = {
  filename: string;
  company: string;
  job_title: string;
  created_at: string;
  user_email: string | null;
};

export type AdminActivityResponse = { items: AdminActivityItem[] };

export async function getAdminStats(): Promise<AdminStatsResponse> {
  const r = await fetch(`${API}/admin/stats`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminStatsResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function getAdminUsers(limit?: number): Promise<AdminUsersResponse> {
  const sp = limit != null ? `?limit=${limit}` : "";
  const r = await fetch(`${API}/admin/users${sp}`, { headers: authHeaders() });
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

export async function getAdminActivity(limit?: number): Promise<AdminActivityResponse> {
  const sp = limit != null ? `?limit=${limit}` : "";
  const r = await fetch(`${API}/admin/activity${sp}`, { headers: authHeaders() });
  const data = await parseJsonOrThrow<AdminActivityResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}
