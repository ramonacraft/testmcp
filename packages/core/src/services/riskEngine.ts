/**
 * Risk engine — the prediction layer.
 *
 * Classifies a PR's changed files (plus title/body keywords) into functional
 * areas from mappings.yaml, then produces a weighted risk assessment that
 * drives test plan scope.
 */

import { minimatch } from "minimatch";
import { PRIORITY_WEIGHT } from "../constants.js";
import { loadMappings, loadTestCases } from "./library.js";
import type {
  AreaHit,
  PrAnalysis,
  PrInfo,
  Priority,
  RiskAssessment,
  TestCase,
  TestPlan,
} from "../types.js";

const GLOB_OPTS = { nocase: true, dot: true };

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some(
    (p) => minimatch(file, p, GLOB_OPTS) || minimatch(file, `**/${p}`, GLOB_OPTS)
  );
}

export function classifyAreas(pr: PrInfo): AreaHit[] {
  const mappings = loadMappings();
  const prose = `${pr.title}\n${pr.body}`.toLowerCase();
  const hits: AreaHit[] = [];

  for (const [areaName, area] of Object.entries(mappings.areas)) {
    const matchedFiles = pr.files
      .map((f) => f.filename)
      .filter((f) => matchesAny(f, area.file_patterns));

    const matchedKeywords = area.keywords.filter((kw) =>
      prose.includes(kw.toLowerCase())
    );

    if (matchedFiles.length === 0 && matchedKeywords.length === 0) continue;

    const confidence: AreaHit["confidence"] =
      matchedFiles.length > 0 && matchedKeywords.length > 0
        ? "high"
        : matchedFiles.length > 0
          ? "medium"
          : "low";

    hits.push({
      area: areaName,
      criticality: area.criticality,
      description: area.description,
      matched_files: matchedFiles.slice(0, 25),
      matched_keywords: matchedKeywords,
      confidence,
    });
  }

  // Highest criticality first, then by evidence strength.
  return hits.sort(
    (a, b) =>
      PRIORITY_WEIGHT[b.criticality] - PRIORITY_WEIGHT[a.criticality] ||
      b.matched_files.length - a.matched_files.length
  );
}

function sizeCategory(totalLines: number, fileCount: number): RiskAssessment["size_category"] {
  if (totalLines < 20 && fileCount <= 2) return "XS";
  if (totalLines < 100 && fileCount <= 5) return "S";
  if (totalLines < 400 && fileCount <= 15) return "M";
  if (totalLines < 1000 && fileCount <= 40) return "L";
  return "XL";
}

export function assessRisk(pr: PrInfo, areas: AreaHit[]): RiskAssessment {
  const mappings = loadMappings();
  const signals = mappings.global_risk_signals;
  const filenames = pr.files.map((f) => f.filename);
  const factors: string[] = [];
  let score = 0;

  // 1. Area criticality (max 40): driven by the most critical area touched,
  //    plus breadth of critical areas.
  const p0Areas = areas.filter((a) => a.criticality === "P0");
  const p1Areas = areas.filter((a) => a.criticality === "P1");
  if (p0Areas.length > 0) {
    score += 30 + Math.min(10, (p0Areas.length - 1) * 5);
    factors.push(
      `Touches ${p0Areas.length} business-critical (P0) area(s): ${p0Areas.map((a) => a.area).join(", ")}`
    );
  } else if (p1Areas.length > 0) {
    score += 18 + Math.min(6, (p1Areas.length - 1) * 3);
    factors.push(
      `Touches ${p1Areas.length} high-priority (P1) area(s): ${p1Areas.map((a) => a.area).join(", ")}`
    );
  } else if (areas.length > 0) {
    score += 8;
    factors.push(`Touches lower-priority areas only: ${areas.map((a) => a.area).join(", ")}`);
  } else {
    factors.push(
      "No mapped functional areas matched — review mappings.yaml coverage for this repo, or treat as low-risk internal change."
    );
  }

  // 2. Change size (max 25).
  const totalLines = pr.additions + pr.deletions;
  const size = sizeCategory(totalLines, pr.changed_files_count);
  const sizeScores: Record<RiskAssessment["size_category"], number> = {
    XS: 2, S: 6, M: 12, L: 19, XL: 25,
  };
  score += sizeScores[size];
  factors.push(
    `Change size ${size}: ${pr.changed_files_count} file(s), +${pr.additions}/-${pr.deletions} lines`
  );

  // 3. Dependency changes (max 15).
  const depChanges = filenames.filter((f) =>
    matchesAny(f, signals.dependency_files?.patterns ?? [])
  );
  if (depChanges.length > 0) {
    score += 15;
    factors.push(
      `Dependency manifest changes (${depChanges.join(", ")}) — blast radius may exceed the visible diff`
    );
  }

  // 4. CI/build config changes (max 10).
  const ciChanges = filenames.filter((f) =>
    matchesAny(f, signals.ci_config_files?.patterns ?? [])
  );
  // Exclude files already counted as dependency changes and TestMCP's own library files.
  const ciOnly = ciChanges.filter((f) => !depChanges.includes(f));
  if (ciOnly.length > 0) {
    score += 10;
    factors.push(`Build/CI configuration changes: ${ciOnly.slice(0, 10).join(", ")}`);
  }

  // 5. Test coverage signal (max 10 penalty).
  const testFiles = filenames.filter((f) =>
    matchesAny(f, signals.test_file_patterns?.patterns ?? [])
  );
  const includesTests = testFiles.length > 0;
  const nonTestCodeChanged = filenames.length > testFiles.length;
  if (!includesTests && nonTestCodeChanged && totalLines > 20) {
    score += 10;
    factors.push("No test files modified alongside code changes — coverage gap");
  } else if (includesTests) {
    factors.push(`Includes test changes (${testFiles.length} test file(s))`);
  }

  score = Math.min(100, Math.round(score));
  const level: RiskAssessment["level"] =
    score >= 70 ? "critical" : score >= 45 ? "high" : score >= 25 ? "medium" : "low";

  return {
    score,
    level,
    factors,
    size_category: size,
    includes_tests: includesTests,
    dependency_changes: depChanges,
    ci_config_changes: ciOnly,
  };
}

export function analyzePr(pr: PrInfo): PrAnalysis {
  const areas = classifyAreas(pr);
  const risk = assessRisk(pr, areas);
  return { pr, areas, risk };
}

const EMPTY_BUCKETS = (): Record<Priority, TestCase[]> => ({
  P0: [],
  P1: [],
  P2: [],
  P3: [],
});

export function buildTestPlan(analysis: PrAnalysis, platforms?: string[]): TestPlan {
  const { pr, areas, risk } = analysis;
  const allCases = loadTestCases();
  const hitAreaNames = new Set(areas.map((a) => a.area));

  // Match library cases to hit areas, optionally filtered by platform.
  const matched = EMPTY_BUCKETS();
  for (const tc of allCases) {
    if (!hitAreaNames.has(tc.area)) continue;
    if (
      platforms?.length &&
      !tc.platforms.some((p) => platforms.includes(p))
    )
      continue;
    matched[tc.priority].push(tc);
  }

  // At elevated risk, always include the P0 smoke set even for unmatched areas.
  if (risk.level === "critical" || risk.level === "high") {
    const p0Ids = new Set(matched.P0.map((tc) => tc.id));
    for (const tc of allCases) {
      if (tc.priority !== "P0" || p0Ids.has(tc.id)) continue;
      if (platforms?.length && !tc.platforms.some((p) => platforms.includes(p))) continue;
      matched.P0.push(tc);
    }
  }

  // Coverage gaps: hit areas with no library cases at all.
  const areasWithCases = new Set(allCases.map((tc) => tc.area));
  const coverageGaps = areas
    .filter((a) => !areasWithCases.has(a.area))
    .map(
      (a) =>
        `Area '${a.area}' matched this PR but has no test cases in the library — add cases or extend an existing one.`
    );
  if (!risk.includes_tests) {
    coverageGaps.push(
      "PR contains no automated test changes — request unit/integration coverage from the author or log a follow-up."
    );
  }

  const regression =
    risk.level === "critical"
      ? "Full regression recommended: run all matched P0–P2 cases plus the complete P0 smoke set across all target platforms before release."
      : risk.level === "high"
        ? "Targeted regression plus full P0 smoke set. Prioritize matched areas on the platforms this PR affects."
        : risk.level === "medium"
          ? "Targeted testing of matched areas; P0 smoke set on the primary platform is sufficient unless issues are found."
          : "Light-touch verification of matched areas; standard release smoke covers the rest.";

  // Prompts the calling AI agent (Claude, etc.) should expand into net-new cases —
  // this is where the MCP layer hands off to the generative layer.
  const suggestedPrompts = areas.slice(0, 5).map(
    (a) =>
      `Draft edge-case test scenarios for '${a.area}' specific to these changed files: ${a.matched_files.slice(0, 5).join(", ") || "(keyword match only — review PR description)"}. Consider failure modes, platform differences, and third-party integration points.`
  );

  const { files: _files, ...prSansFiles } = pr;

  return {
    generated_at: new Date().toISOString(),
    pr: prSansFiles,
    risk,
    areas,
    matched_cases: matched,
    regression_recommendation: regression,
    coverage_gaps: coverageGaps,
    suggested_new_case_prompts: suggestedPrompts,
  };
}
