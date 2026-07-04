/** Shared type definitions for TestMCP. */

export type Priority = "P0" | "P1" | "P2" | "P3";
export type Platform = "web" | "ios" | "android" | "ctv";
export type AutomationStatus = "manual" | "automated" | "automated-candidate";

export interface TestCase {
  id: string;
  title: string;
  priority: Priority;
  area: string;
  platforms: Platform[];
  tags: string[];
  preconditions?: string;
  steps: string[];
  expected: string;
  automation?: AutomationStatus;
  source?: string; // which library file it came from
}

export interface AreaMapping {
  description: string;
  criticality: Priority;
  file_patterns: string[];
  keywords: string[];
}

export interface GlobalRiskSignal {
  patterns: string[];
  note: string;
}

export interface Mappings {
  areas: Record<string, AreaMapping>;
  global_risk_signals: Record<string, GlobalRiskSignal>;
}

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
}

export interface PrInfo {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  base_branch: string;
  head_branch: string;
  state: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changed_files_count: number;
  labels: string[];
  url: string;
  files: ChangedFile[];
}

export interface AreaHit {
  area: string;
  criticality: Priority;
  description: string;
  matched_files: string[];
  matched_keywords: string[];
  confidence: "high" | "medium" | "low";
}

export interface RiskAssessment {
  score: number; // 0-100
  level: "critical" | "high" | "medium" | "low";
  factors: string[];
  size_category: "XS" | "S" | "M" | "L" | "XL";
  includes_tests: boolean;
  dependency_changes: string[];
  ci_config_changes: string[];
}

export interface PrAnalysis {
  pr: PrInfo;
  areas: AreaHit[];
  risk: RiskAssessment;
}

export interface TestPlan {
  generated_at: string;
  pr: Omit<PrInfo, "files">;
  risk: RiskAssessment;
  areas: AreaHit[];
  matched_cases: Record<Priority, TestCase[]>;
  regression_recommendation: string;
  coverage_gaps: string[];
  suggested_new_case_prompts: string[];
}
