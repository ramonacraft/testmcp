/** Typed API client for the TestMCP dashboard. */

export interface Health {
  ok: boolean;
  version: string;
  github_token: boolean;
  library_dir: string;
}

export interface TestCase {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2" | "P3";
  area: string;
  platforms: string[];
  tags: string[];
  preconditions?: string;
  steps: string[];
  expected: string;
  automation?: string;
  source?: string;
}

export interface AreaInfo {
  area: string;
  criticality: string;
  description: string;
  case_count: number;
  file_patterns: string[];
  keywords: string[];
}

export interface AreaHit {
  area: string;
  criticality: string;
  description: string;
  matched_files: string[];
  matched_keywords: string[];
  confidence: string;
}

export interface Risk {
  score: number;
  level: "critical" | "high" | "medium" | "low";
  factors: string[];
  size_category: string;
  includes_tests: boolean;
  dependency_changes: string[];
  ci_config_changes: string[];
}

export interface PrMeta {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  base_branch: string;
  head_branch: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changed_files_count: number;
  url: string;
}

export interface Plan {
  generated_at: string;
  pr: PrMeta;
  risk: Risk;
  areas: AreaHit[];
  matched_cases: Record<"P0" | "P1" | "P2" | "P3", TestCase[]>;
  regression_recommendation: string;
  coverage_gaps: string[];
  suggested_new_case_prompts: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  health: () => request<Health>("/api/health"),
  areas: () => request<{ count: number; areas: AreaInfo[] }>("/api/areas"),
  cases: (params: Record<string, string>) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v)
    ).toString();
    return request<{ count: number; test_cases: TestCase[] }>(
      `/api/cases${qs ? `?${qs}` : ""}`
    );
  },
  addCase: (tc: Omit<TestCase, "id" | "source">) =>
    request<{ test_case: TestCase }>("/api/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tc),
    }),
  plan: (owner: string, repo: string, pr: number, platforms: string[]) =>
    request<{ plan: Plan; markdown: string }>(
      `/api/pr/${owner}/${repo}/${pr}/plan${platforms.length ? `?platforms=${platforms.join(",")}` : ""}`
    ),
};

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
