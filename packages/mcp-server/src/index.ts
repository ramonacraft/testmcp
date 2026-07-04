#!/usr/bin/env node
/**
 * TestMCP Test Case Management — MCP Server
 *
 * An AI QA prediction layer for GitHub pull requests. Analyzes PR changes,
 * classifies them into business-critical functional areas, and drafts
 * prioritized (P0–P3) test plans from an editable YAML test case library.
 *
 * Complements existing code-review agents on a repository by adding the QA
 * perspective: what should a human (or automation suite) verify before this
 * ships?
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CHARACTER_LIMIT, LIBRARY_DIR, SERVER_NAME, SERVER_VERSION } from "@testmcp/core";
import {
  appendCustomCase,
  filterCases,
  invalidateCache,
  loadMappings,
  loadTestCases,
  nextCustomId,
  searchCases,
} from "@testmcp/core";
import { fetchPullRequest, handleGitHubError } from "@testmcp/core";
import { analyzePr, buildTestPlan } from "@testmcp/core";
import { formatAnalysisMarkdown, formatCaseFull, formatPlanMarkdown } from "@testmcp/core";
import type { Platform, Priority, TestCase } from "@testmcp/core";

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    "\n\n…[truncated — narrow the request with filters (priority, area, platform) to see more]"
  );
}

function textResult(text: string, structured?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: truncate(text) }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tool: testmcp_analyze_pr
// ---------------------------------------------------------------------------

const AnalyzePrSchema = z
  .object({
    owner: z.string().min(1).describe("GitHub repository owner/org, e.g. 'your-org'"),
    repo: z.string().min(1).describe("Repository name, e.g. 'web-app'"),
    pr_number: z.number().int().min(1).describe("Pull request number"),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("'markdown' for human-readable, 'json' for machine-readable"),
  })
  .strict();

server.registerTool(
  "testmcp_analyze_pr",
  {
    title: "Analyze a GitHub PR for QA risk",
    description: `Fetch a GitHub pull request, classify its changed files into functional areas (video playback, live streaming, analytics, auth, terms/compliance, navigation, etc.), and produce a QA risk assessment (0-100 score, risk level, contributing factors).

Use this first to understand what a PR touches from a QA perspective. Follow with testmcp_generate_test_plan to get the full prioritized test plan.

Args:
  - owner (string): GitHub repo owner/org
  - repo (string): repository name
  - pr_number (number): PR number
  - response_format ('markdown' | 'json')

Returns: risk score/level with factors, impacted areas with matched files/keywords and confidence, PR metadata.

Requires: GITHUB_TOKEN env var for private repos (public repos work unauthenticated but are rate-limited).`,
    inputSchema: AnalyzePrSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params: z.infer<typeof AnalyzePrSchema>) => {
    try {
      const pr = await fetchPullRequest(params.owner, params.repo, params.pr_number);
      const analysis = analyzePr(pr);
      const structured = {
        risk: analysis.risk,
        areas: analysis.areas,
        pr: { ...analysis.pr, files: analysis.pr.files.slice(0, 100) },
      };
      const text =
        params.response_format === ResponseFormat.JSON
          ? JSON.stringify(structured, null, 2)
          : formatAnalysisMarkdown(analysis);
      return textResult(text, structured as Record<string, unknown>);
    } catch (error) {
      return textResult(
        handleGitHubError(error, `analyzing PR ${params.owner}/${params.repo}#${params.pr_number}`)
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: testmcp_generate_test_plan
// ---------------------------------------------------------------------------

const GenerateTestPlanSchema = z
  .object({
    owner: z.string().min(1).describe("GitHub repository owner/org"),
    repo: z.string().min(1).describe("Repository name"),
    pr_number: z.number().int().min(1).describe("Pull request number"),
    platforms: z
      .array(z.enum(["web", "ios", "android", "ctv"]))
      .optional()
      .describe("Limit the plan to these platforms (default: all platforms)"),
    full_detail: z
      .boolean()
      .default(false)
      .describe("true = include full steps/expected results per case; false = one-line summaries"),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("'markdown' for human-readable plan, 'json' for structured export (Jira workflows, CI pipelines)"),
  })
  .strict();

server.registerTool(
  "testmcp_generate_test_plan",
  {
    title: "Generate a prioritized test plan for a PR",
    description: `Generate a complete, risk-based test plan for a GitHub pull request. Combines PR analysis with the P0-P3 test case library: matched cases per priority, regression scope recommendation, coverage gaps, and prompts for AI-generated net-new edge cases.

At high/critical risk the full P0 smoke set is automatically included even for areas the PR did not directly touch.

Args:
  - owner, repo, pr_number: identify the PR
  - platforms (array, optional): filter cases to ['web','ios','android','ctv']
  - full_detail (boolean): full test case steps vs one-line summaries (default false)
  - response_format ('markdown' | 'json'): markdown for humans/PR comments; json for tooling import

Returns (json schema): { generated_at, pr, risk, areas, matched_cases: {P0:[],P1:[],P2:[],P3:[]}, regression_recommendation, coverage_gaps, suggested_new_case_prompts }

The markdown output is designed to be pasted directly as a PR comment.`,
    inputSchema: GenerateTestPlanSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params: z.infer<typeof GenerateTestPlanSchema>) => {
    try {
      const pr = await fetchPullRequest(params.owner, params.repo, params.pr_number);
      const analysis = analyzePr(pr);
      const plan = buildTestPlan(analysis, params.platforms);
      const text =
        params.response_format === ResponseFormat.JSON
          ? JSON.stringify(plan, null, 2)
          : formatPlanMarkdown(plan, params.full_detail);
      return textResult(text, plan as unknown as Record<string, unknown>);
    } catch (error) {
      return textResult(
        handleGitHubError(
          error,
          `generating test plan for PR ${params.owner}/${params.repo}#${params.pr_number}`
        )
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: testmcp_list_test_cases
// ---------------------------------------------------------------------------

const ListCasesSchema = z
  .object({
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional().describe("Filter by priority"),
    area: z.string().optional().describe("Filter by functional area, e.g. 'video-playback'"),
    platform: z.enum(["web", "ios", "android", "ctv"]).optional().describe("Filter by platform"),
    tag: z.string().optional().describe("Filter by tag, e.g. 'smoke'"),
    full_detail: z.boolean().default(false).describe("Include full steps and expected results"),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN),
  })
  .strict();

server.registerTool(
  "testmcp_list_test_cases",
  {
    title: "List test cases in the library",
    description: `List test cases from the TestMCP library, optionally filtered by priority (P0-P3), area, platform, or tag. Use testmcp_list_areas to see valid area names.

Returns case summaries (or full detail) plus counts.`,
    inputSchema: ListCasesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: z.infer<typeof ListCasesSchema>) => {
    invalidateCache(); // pick up any manual YAML edits
    const cases = filterCases(params);
    const structured = { count: cases.length, test_cases: cases };
    if (params.response_format === ResponseFormat.JSON) {
      return textResult(JSON.stringify(structured, null, 2), structured);
    }
    if (!cases.length) {
      return textResult(
        "No test cases matched those filters. Try testmcp_list_areas to see valid areas, or relax the filters."
      );
    }
    const lines = [`# Test Cases (${cases.length})`, ""];
    for (const tc of cases) {
      lines.push(
        params.full_detail
          ? formatCaseFull(tc) + "\n"
          : `- **${tc.id}** [${tc.priority}] ${tc.title} _(${tc.area}; ${tc.platforms.join(", ")})_`
      );
    }
    return textResult(lines.join("\n"), structured);
  }
);

// ---------------------------------------------------------------------------
// Tool: testmcp_search_test_cases
// ---------------------------------------------------------------------------

const SearchCasesSchema = z
  .object({
    query: z.string().min(2).max(200).describe("Free-text search across id, title, steps, tags, area"),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN),
  })
  .strict();

server.registerTool(
  "testmcp_search_test_cases",
  {
    title: "Search test cases",
    description: `Free-text search across the test case library (id, title, steps, expected results, tags, area). Example queries: 'heartbeat', 'captions', 'deep link', 'adobe'.`,
    inputSchema: SearchCasesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: z.infer<typeof SearchCasesSchema>) => {
    invalidateCache();
    const cases = searchCases(params.query);
    const structured = { count: cases.length, test_cases: cases };
    if (params.response_format === ResponseFormat.JSON) {
      return textResult(JSON.stringify(structured, null, 2), structured);
    }
    if (!cases.length) {
      return textResult(`No test cases found matching '${params.query}'.`);
    }
    const lines = [`# Search results for '${params.query}' (${cases.length})`, ""];
    for (const tc of cases) {
      lines.push(`- **${tc.id}** [${tc.priority}] ${tc.title} _(${tc.area})_`);
    }
    return textResult(lines.join("\n"), structured);
  }
);

// ---------------------------------------------------------------------------
// Tool: testmcp_add_test_case
// ---------------------------------------------------------------------------

const AddCaseSchema = z
  .object({
    title: z.string().min(5).max(200).describe("Concise test case title"),
    priority: z.enum(["P0", "P1", "P2", "P3"]).describe("Business priority"),
    area: z.string().min(2).describe("Functional area (see testmcp_list_areas; new areas allowed)"),
    platforms: z
      .array(z.enum(["web", "ios", "android", "ctv"]))
      .min(1)
      .describe("Applicable platforms"),
    tags: z.array(z.string()).default([]).describe("Tags, e.g. ['smoke','analytics']"),
    preconditions: z.string().optional().describe("Setup required before executing"),
    steps: z.array(z.string()).min(1).describe("Ordered execution steps"),
    expected: z.string().min(5).describe("Expected result"),
    automation: z
      .enum(["manual", "automated", "automated-candidate"])
      .default("manual")
      .describe("Automation status"),
  })
  .strict();

server.registerTool(
  "testmcp_add_test_case",
  {
    title: "Add a test case to the library",
    description: `Add a new test case to the TestMCP library. The case is persisted to custom.yaml in the library directory and immediately available to test plan generation. IDs are auto-assigned (TC-CUST-###).

Use this to capture net-new cases generated during PR analysis so the library learns over time.`,
    inputSchema: AddCaseSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params: z.infer<typeof AddCaseSchema>) => {
    try {
      const tc: TestCase = {
        id: nextCustomId(),
        title: params.title,
        priority: params.priority as Priority,
        area: params.area,
        platforms: params.platforms as Platform[],
        tags: params.tags,
        ...(params.preconditions ? { preconditions: params.preconditions } : {}),
        steps: params.steps,
        expected: params.expected,
        automation: params.automation,
      };
      appendCustomCase(tc);
      return textResult(
        `Added **${tc.id}** — ${tc.title} [${tc.priority}, ${tc.area}] to custom.yaml.`,
        { test_case: tc } as unknown as Record<string, unknown>
      );
    } catch (error) {
      return textResult(
        `Error: could not write to the library: ${error instanceof Error ? error.message : String(error)}. Check that '${LIBRARY_DIR}' is writable.`
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: testmcp_list_areas
// ---------------------------------------------------------------------------

const ListAreasSchema = z
  .object({
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN),
  })
  .strict();

server.registerTool(
  "testmcp_list_areas",
  {
    title: "List functional areas and risk mappings",
    description: `List all functional areas TestMCP knows about (from mappings.yaml): description, criticality, file patterns, keywords, and how many library cases exist per area. Use this to understand or extend the risk mapping.`,
    inputSchema: ListAreasSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: z.infer<typeof ListAreasSchema>) => {
    invalidateCache();
    const mappings = loadMappings();
    const cases = loadTestCases();
    const caseCount = (area: string) => cases.filter((tc) => tc.area === area).length;

    const areas = Object.entries(mappings.areas).map(([name, a]) => ({
      area: name,
      criticality: a.criticality,
      description: a.description,
      case_count: caseCount(name),
      file_patterns: a.file_patterns,
      keywords: a.keywords,
    }));
    const structured = { count: areas.length, areas };

    if (params.response_format === ResponseFormat.JSON) {
      return textResult(JSON.stringify(structured, null, 2), structured);
    }
    const lines = [`# TestMCP Functional Areas (${areas.length})`, ""];
    for (const a of areas) {
      lines.push(
        `- **${a.area}** [${a.criticality}] — ${a.description} _(${a.case_count} case(s))_`
      );
    }
    lines.push("", `Library directory: ${LIBRARY_DIR}`);
    return textResult(lines.join("\n"), structured);
  }
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    console.error(
      "WARNING: GITHUB_TOKEN not set. Public repos will work with rate limits; private repos will fail."
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running via stdio (library: ${LIBRARY_DIR})`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
