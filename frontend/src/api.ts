const API = "/api";

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
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function parseJob(params: { url?: string; text?: string }): Promise<JobPostingOut> {
  const r = await fetch(`${API}/job/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      throw new Error(j.detail || t);
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new Error(t);
    }
  }
  return r.json();
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
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail || "Optimize failed");
  return data;
}

export async function getHistory(): Promise<HistoryResponse> {
  const r = await fetch(`${API}/history`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function downloadUrl(filename: string): string {
  return `${API}/history/download/${encodeURIComponent(filename)}`;
}

export async function getSettings(): Promise<SettingsResponse> {
  const r = await fetch(`${API}/settings`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
