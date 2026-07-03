/** TestMCP web server — REST API over @testmcp/core + static dashboard hosting. */

import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIBRARY_DIR,
  SERVER_VERSION,
  analyzePr,
  appendCustomCase,
  buildTestPlan,
  fetchPullRequest,
  filterCases,
  formatPlanMarkdown,
  handleGitHubError,
  invalidateCache,
  loadMappings,
  loadTestCases,
  nextCustomId,
  searchCases,
  type Platform,
  type Priority,
  type TestCase,
} from "@testmcp/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    version: SERVER_VERSION,
    github_token: Boolean(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN),
    library_dir: LIBRARY_DIR,
  });
});

app.get("/api/areas", (_req: Request, res: Response) => {
  try {
    invalidateCache();
    const mappings = loadMappings();
    const cases = loadTestCases();
    const areas = Object.entries(mappings.areas).map(([name, a]) => ({
      area: name,
      criticality: a.criticality,
      description: a.description,
      case_count: cases.filter((tc) => tc.area === name).length,
      file_patterns: a.file_patterns,
      keywords: a.keywords,
    }));
    res.json({ count: areas.length, areas });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/cases", (req: Request, res: Response) => {
  try {
    invalidateCache();
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    let cases: TestCase[] = q
      ? searchCases(q)
      : filterCases({});
    const { priority, area, platform, tag } = req.query as Record<string, string | undefined>;
    cases = cases.filter((tc) => {
      if (priority && tc.priority !== priority) return false;
      if (area && tc.area !== area) return false;
      if (platform && !tc.platforms.includes(platform as Platform)) return false;
      if (tag && !tc.tags.includes(tag)) return false;
      return true;
    });
    res.json({ count: cases.length, test_cases: cases });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/cases", (req: Request, res: Response) => {
  try {
    const b = req.body as Partial<TestCase>;
    if (!b.title || !b.priority || !b.area || !b.platforms?.length || !b.steps?.length || !b.expected) {
      res.status(400).json({
        error: "Required fields: title, priority (P0-P3), area, platforms[], steps[], expected",
      });
      return;
    }
    const tc: TestCase = {
      id: nextCustomId(),
      title: b.title,
      priority: b.priority as Priority,
      area: b.area,
      platforms: b.platforms as Platform[],
      tags: b.tags ?? [],
      ...(b.preconditions ? { preconditions: b.preconditions } : {}),
      steps: b.steps,
      expected: b.expected,
      automation: b.automation ?? "manual",
    };
    appendCustomCase(tc);
    res.status(201).json({ test_case: tc });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/pr/:owner/:repo/:number/analysis", async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const prNumber = parseInt(req.params.number, 10);
  try {
    invalidateCache();
    const pr = await fetchPullRequest(owner, repo, prNumber);
    const analysis = analyzePr(pr);
    res.json({
      risk: analysis.risk,
      areas: analysis.areas,
      pr: { ...analysis.pr, files: analysis.pr.files.slice(0, 200) },
    });
  } catch (e) {
    res.status(502).json({ error: handleGitHubError(e, `analyzing PR ${owner}/${repo}#${prNumber}`) });
  }
});

app.get("/api/pr/:owner/:repo/:number/plan", async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const prNumber = parseInt(req.params.number, 10);
  const platformsParam = typeof req.query.platforms === "string" ? req.query.platforms : "";
  const platforms = platformsParam
    ? platformsParam.split(",").map((p) => p.trim()).filter(Boolean)
    : undefined;
  try {
    invalidateCache();
    const pr = await fetchPullRequest(owner, repo, prNumber);
    const plan = buildTestPlan(analyzePr(pr), platforms);
    res.json({ plan, markdown: formatPlanMarkdown(plan, true) });
  } catch (e) {
    res.status(502).json({ error: handleGitHubError(e, `generating test plan for PR ${owner}/${repo}#${prNumber}`) });
  }
});

// ---------------------------------------------------------------------------
// Static dashboard
// ---------------------------------------------------------------------------

const distDir = path.resolve(__dirname, "..", "dist");
app.use(express.static(distDir));
app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const port = parseInt(process.env.PORT ?? "4173", 10);
app.listen(port, () => {
  console.log(`🧪  TestMCP dashboard: http://localhost:${port}  (library: ${LIBRARY_DIR})`);
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    console.log("   WARNING: GITHUB_TOKEN not set — private repos unavailable, public repos rate-limited.");
  }
});
