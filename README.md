# 🧪 TestMCP — AI QA Prediction Layer for GitHub PRs

TestMCP sees what to test before it ships. It analyzes what a pull request actually changes and drafts a prioritized (P0–P3) test plan from an editable, business-driven test case library. It complements the code-review agents already on your repo by adding the QA perspective: *what must a human or automation suite verify before this ships?*

Built for web, mobile (iOS/Android), and CTV app teams.

## Structure

```
testmcp/
├── library/                  # The shared YAML test case library + risk mappings
│   ├── p0-critical.yaml … p3-low.yaml
│   ├── custom.yaml           # cases added at runtime
│   └── mappings.yaml         # the prediction brain: file globs/keywords → areas
└── packages/
    ├── core/                 # @testmcp/core — risk engine, library service, GitHub client
    ├── mcp-server/           # @testmcp/mcp-server — 6 MCP tools over stdio
    └── web/                  # @testmcp/web — Express API + React dashboard
```

One engine, two faces: the **MCP server** plugs TestMCP into Claude Code / Claude Desktop / Cursor; the **web dashboard** gives QA teams a visual home. Both share `@testmcp/core` and the same `library/`, so a case added in either place shows up in both.

## Quick start

Requires Node 18+.

```bash
npm install
npm run build

# Web dashboard → http://localhost:4173
GITHUB_TOKEN=ghp_yourtoken npm run web

# MCP server (stdio)
GITHUB_TOKEN=ghp_yourtoken npm run mcp
```

### GitHub token

Fine-grained PAT with **Pull requests: read** and **Contents: read**. Public repos work without one (rate-limited); private repos require it.

## The dashboard

Three views:

- **Analyze PR** — enter `owner / repo / #`, optionally filter platforms, and get the live risk dial (0–100), contributing factors, impacted area chips, and the full P0–P3 plan with expandable case steps. Copy the plan as Markdown for a PR comment, or download `.md` / `.json` (the JSON matches the MCP tool output — usable in Jira workflows and CI pipelines). Test case management is built in via the YAML library, so no third-party TCM tool is required.
- **Test Library** — search/filter every case by priority, platform, and area; add new cases through the form (persisted to `library/custom.yaml`).
- **Risk Areas** — the mapping table that drives predictions. Tune `library/mappings.yaml` to your codebase and TestMCP gets sharper.

## The MCP server

Register with Claude Code:

```bash
claude mcp add testmcp \
  --env GITHUB_TOKEN=ghp_yourtoken \
  -- node /absolute/path/to/testmcp/packages/mcp-server/dist/index.js
```

Claude Desktop / Cursor config:

```json
{
  "mcpServers": {
    "testmcp": {
      "command": "node",
      "args": ["/absolute/path/to/testmcp/packages/mcp-server/dist/index.js"],
      "env": { "GITHUB_TOKEN": "ghp_yourtoken" }
    }
  }
}
```

Tools: `testmcp_analyze_pr`, `testmcp_generate_test_plan`, `testmcp_list_test_cases`, `testmcp_search_test_cases`, `testmcp_add_test_case`, `testmcp_list_areas`.

## How the prediction works

1. **Fetch** — PR metadata + changed files via the GitHub API.
2. **Classify** — file globs and keywords in `mappings.yaml` route changes to functional areas (video playback, live streaming, analytics, auth, terms/compliance, navigation…), each with a criticality.
3. **Score** — 0–100 risk from area criticality (≤40), change size (≤25), dependency manifest changes (≤15), CI/build config changes (≤10), and missing test coverage (≤10). Levels: critical ≥70, high ≥45, medium ≥25.
4. **Plan** — matched cases per priority; at high/critical risk the full P0 smoke set is auto-included. Coverage gaps and AI-expansion prompts round out the plan.

## Customizing

- Point either app at a different library: `TESTMCP_LIBRARY_DIR=/path/to/library`
- Dashboard port: `PORT=8080 npm run web`
- All library files are plain YAML — diffable, reviewable, can live in the repo under test.

## Roadmap

- GitHub Action that posts the plan as a PR comment automatically
- Historical bug-density weighting per file/area
- Jira integration: create/link bugs and test tasks from a plan (TestMCP's YAML library IS the test case management layer — no third-party TCM by design)
- Execution tracking: pass/fail per case, release-readiness rollup

---

*TestMCP v0.2.0 — created by Ramona Bonitatis. MIT license.*
