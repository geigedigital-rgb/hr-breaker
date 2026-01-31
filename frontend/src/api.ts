const API = "/api";

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
export type OptimizeResponse = {
  success: boolean;
  pdf_base64: string | null;
  pdf_filename: string | null;
  validation: ValidationResultOut;
  job: JobPostingOut;
  error: string | null;
};
export type HistoryItem = {
  filename: string;
  company: string;
  job_title: string;
  timestamp: string;
  first_name: string | null;
  last_name: string | null;
};
export type HistoryResponse = { items: HistoryItem[] };
export type SettingsResponse = {
  has_api_key: boolean;
  max_iterations: number;
  output_dir: string;
};

export async function extractName(content: string): Promise<ExtractNameResponse> {
  const r = await fetch(`${API}/resume/extract-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await parseJsonOrThrow<ExtractNameResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export type ParsePdfResponse = { content: string };

export async function parseResumePdf(file: File): Promise<ParsePdfResponse> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API}/resume/parse-pdf`, {
    method: "POST",
    body: form,
  });
  const data = await parseJsonOrThrow<ParsePdfResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function parseJob(params: { url?: string; text?: string }): Promise<JobPostingOut> {
  const r = await fetch(`${API}/job/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<JobPostingOut & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}

export async function optimize(params: {
  resume_content: string;
  job_text?: string;
  job_url?: string;
  max_iterations?: number;
  parallel?: boolean;
}): Promise<OptimizeResponse> {
  const r = await fetch(`${API}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await parseJsonOrThrow<OptimizeResponse & { detail?: string }>(r);
  if (!r.ok) throw new Error(data.detail || "Optimize failed");
  return data;
}

export async function getHistory(): Promise<HistoryResponse> {
  const r = await fetch(`${API}/history`);
  const data = await parseJsonOrThrow<HistoryResponse>(r);
  if (!r.ok) throw new Error((data as { detail?: string }).detail || r.statusText);
  return data;
}

export function downloadUrl(filename: string): string {
  return `${API}/history/download/${encodeURIComponent(filename)}`;
}

export async function getSettings(): Promise<SettingsResponse> {
  const r = await fetch(`${API}/settings`);
  const data = await parseJsonOrThrow<SettingsResponse>(r);
  if (!r.ok) throw new Error((data as { detail?: string }).detail || r.statusText);
  return data;
}
