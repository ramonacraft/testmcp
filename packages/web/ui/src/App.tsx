import { useEffect, useMemo, useState } from "react";
import {
  api,
  download,
  type AreaInfo,
  type Health,
  type Plan,
  type TestCase,
} from "./api";

const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const PLATFORMS = ["web", "ios", "android", "ctv"] as const;

const PRIORITY_LABEL: Record<string, string> = {
  P0: "P0 · Critical",
  P1: "P1 · High",
  P2: "P2 · Medium",
  P3: "P3 · Low",
};

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function PriorityBadge({ p }: { p: string }) {
  return <span className={`badge prio-${p}`}>{p}</span>;
}

function RiskDial({ score, level }: { score: number; level: string }) {
  const deg = Math.round((score / 100) * 360);
  return (
    <div className={`risk-dial level-${level}`} style={{ ["--deg" as string]: `${deg}deg` }}>
      <div className="risk-dial-inner">
        <span className="risk-score">{score}</span>
        <span className="risk-label">{level.toUpperCase()}</span>
      </div>
    </div>
  );
}

function CaseCard({ tc }: { tc: TestCase }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="case-card">
      <button className="case-head" onClick={() => setOpen(!open)}>
        <PriorityBadge p={tc.priority} />
        <span className="case-id">{tc.id}</span>
        <span className="case-title">{tc.title}</span>
        <span className="case-meta">{tc.area}</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="case-body">
          <div className="case-tags">
            {tc.platforms.map((p) => (
              <span key={p} className="tag plat">{p}</span>
            ))}
            {tc.tags.map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
            <span className="tag auto">{tc.automation ?? "manual"}</span>
          </div>
          {tc.preconditions && (
            <p><strong>Preconditions:</strong> {tc.preconditions}</p>
          )}
          <strong>Steps</strong>
          <ol>
            {tc.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p><strong>Expected:</strong> {tc.expected}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analyze view
// ---------------------------------------------------------------------------

function AnalyzeView({ tokenPresent }: { tokenPresent: boolean }) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [pr, setPr] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ plan: Plan; markdown: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const togglePlatform = (p: string) =>
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );

  const run = async () => {
    if (!owner || !repo || !pr) {
      setError("Owner, repo, and PR number are required.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setResult(await api.plan(owner.trim(), repo.trim(), parseInt(pr, 10), platforms));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const plan = result?.plan;
  const totalMatched = plan
    ? PRIORITIES.reduce((n, p) => n + plan.matched_cases[p].length, 0)
    : 0;

  return (
    <div>
      <div className="panel">
        <div className="form-row">
          <input placeholder="owner (e.g. your-org)" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <span className="sep">/</span>
          <input placeholder="repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
          <span className="sep">#</span>
          <input className="pr-num" placeholder="PR #" value={pr} onChange={(e) => setPr(e.target.value.replace(/\D/g, ""))} />
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? "Analyzing…" : "Generate Test Plan"}
          </button>
        </div>
        <div className="form-row platforms">
          <span className="hint">Platforms (empty = all):</span>
          {PLATFORMS.map((p) => (
            <label key={p} className={`plat-check ${platforms.includes(p) ? "on" : ""}`}>
              <input type="checkbox" checked={platforms.includes(p)} onChange={() => togglePlatform(p)} />
              {p}
            </label>
          ))}
        </div>
        {!tokenPresent && (
          <p className="warn">No GITHUB_TOKEN detected — public repos only, rate-limited. Set the env var and restart to analyze private repos.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {plan && result && (
        <>
          <div className="panel risk-panel">
            <RiskDial score={plan.risk.score} level={plan.risk.level} />
            <div className="risk-detail">
              <h2>
                <a href={plan.pr.url} target="_blank" rel="noreferrer">
                  {plan.pr.owner}/{plan.pr.repo}#{plan.pr.number}
                </a>{" "}
                — {plan.pr.title}
              </h2>
              <p className="muted">
                @{plan.pr.author} · {plan.pr.head_branch} → {plan.pr.base_branch} · size {plan.risk.size_category} ·{" "}
                {plan.pr.changed_files_count} files (+{plan.pr.additions}/−{plan.pr.deletions})
                {plan.pr.draft ? " · DRAFT" : ""}
              </p>
              <ul className="factors">
                {plan.risk.factors.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              <div className="area-chips">
                {plan.areas.map((a) => (
                  <span key={a.area} className={`chip crit-${a.criticality}`} title={`${a.description} — confidence: ${a.confidence}`}>
                    {a.area} <em>{a.criticality}</em>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="plan-toolbar">
              <h2>Test plan · {totalMatched} cases</h2>
              <div className="btns">
                <button onClick={() => { navigator.clipboard.writeText(result.markdown); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? "Copied ✓" : "Copy Markdown"}
                </button>
                <button onClick={() => download(`testmcp-plan-${plan.pr.repo}-${plan.pr.number}.md`, result.markdown, "text/markdown")}>
                  ⬇ .md
                </button>
                <button onClick={() => download(`testmcp-plan-${plan.pr.repo}-${plan.pr.number}.json`, JSON.stringify(plan, null, 2), "application/json")}>
                  ⬇ .json
                </button>
              </div>
            </div>
            <p className="reco">{plan.regression_recommendation}</p>
            {PRIORITIES.map((p) =>
              plan.matched_cases[p].length ? (
                <section key={p}>
                  <h3 className={`prio-head prio-${p}`}>{PRIORITY_LABEL[p]} · {plan.matched_cases[p].length}</h3>
                  {plan.matched_cases[p].map((tc) => (
                    <CaseCard key={tc.id} tc={tc} />
                  ))}
                </section>
              ) : null
            )}
            {plan.coverage_gaps.length > 0 && (
              <section>
                <h3 className="gap-head">⚠️ Coverage gaps</h3>
                <ul className="factors">
                  {plan.coverage_gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </section>
            )}
            {plan.suggested_new_case_prompts.length > 0 && (
              <section>
                <h3>🤖 Suggested AI-generated additions</h3>
                <p className="muted">Hand these prompts to your agent to draft net-new, PR-specific edge cases:</p>
                <ul className="factors">
                  {plan.suggested_new_case_prompts.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library view
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  title: "",
  priority: "P1" as TestCase["priority"],
  area: "",
  platforms: [] as string[],
  tags: "",
  preconditions: "",
  steps: "",
  expected: "",
};

function LibraryView({ areas }: { areas: AreaInfo[] }) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [platform, setPlatform] = useState("");
  const [area, setArea] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formMsg, setFormMsg] = useState("");

  const refresh = async () => {
    const res = await api.cases({ q, priority, platform, area });
    setCases(res.test_cases);
  };

  useEffect(() => {
    refresh().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, priority, platform, area]);

  const submit = async () => {
    try {
      setFormMsg("");
      const created = await api.addCase({
        title: form.title,
        priority: form.priority,
        area: form.area,
        platforms: form.platforms,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        ...(form.preconditions ? { preconditions: form.preconditions } : {}),
        steps: form.steps.split("\n").map((s) => s.trim()).filter(Boolean),
        expected: form.expected,
        automation: "manual",
      });
      setFormMsg(`Added ${created.test_case.id} ✓`);
      setForm({ ...EMPTY_FORM });
      await refresh();
    } catch (e) {
      setFormMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const grouped = useMemo(
    () =>
      PRIORITIES.map((p) => ({ p, items: cases.filter((c) => c.priority === p) })).filter(
        (g) => g.items.length
      ),
    [cases]
  );

  return (
    <div>
      <div className="panel">
        <div className="form-row">
          <input className="grow" placeholder="Search cases… (title, steps, tags)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">All platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a.area}>{a.area}</option>
            ))}
          </select>
          <button className="primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Close" : "+ Add Case"}
          </button>
        </div>
        {showForm && (
          <div className="add-form">
            <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div className="form-row">
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TestCase["priority"] })}>
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <input placeholder="Area (e.g. video-playback)" list="areas-list" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
              <datalist id="areas-list">
                {areas.map((a) => (
                  <option key={a.area}>{a.area}</option>
                ))}
              </datalist>
              {PLATFORMS.map((p) => (
                <label key={p} className={`plat-check ${form.platforms.includes(p) ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={form.platforms.includes(p)}
                    onChange={() =>
                      setForm({
                        ...form,
                        platforms: form.platforms.includes(p)
                          ? form.platforms.filter((x) => x !== p)
                          : [...form.platforms, p],
                      })
                    }
                  />
                  {p}
                </label>
              ))}
            </div>
            <input placeholder="Tags (comma-separated)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            <input placeholder="Preconditions (optional)" value={form.preconditions} onChange={(e) => setForm({ ...form, preconditions: e.target.value })} />
            <textarea placeholder="Steps — one per line" rows={4} value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} />
            <textarea placeholder="Expected result" rows={2} value={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.value })} />
            <div className="form-row">
              <button className="primary" onClick={submit}>Save to library</button>
              {formMsg && <span className="hint">{formMsg}</span>}
            </div>
          </div>
        )}
      </div>
      {grouped.map(({ p, items }) => (
        <section key={p}>
          <h3 className={`prio-head prio-${p}`}>{PRIORITY_LABEL[p]} · {items.length}</h3>
          {items.map((tc) => (
            <CaseCard key={tc.id} tc={tc} />
          ))}
        </section>
      ))}
      {!cases.length && <p className="muted panel">No cases match those filters.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Areas view
// ---------------------------------------------------------------------------

function AreasView({ areas }: { areas: AreaInfo[] }) {
  return (
    <div className="panel">
      <p className="muted">
        TestMCP's prediction brain: file patterns and keywords route PR changes to these areas.
        Edit <code>library/mappings.yaml</code> to tune it to your codebase.
      </p>
      <table className="areas-table">
        <thead>
          <tr>
            <th>Area</th>
            <th>Crit.</th>
            <th>Cases</th>
            <th>Description</th>
            <th>Signals</th>
          </tr>
        </thead>
        <tbody>
          {areas.map((a) => (
            <tr key={a.area}>
              <td className="mono">{a.area}</td>
              <td><PriorityBadge p={a.criticality} /></td>
              <td>{a.case_count}</td>
              <td>{a.description}</td>
              <td className="signals">
                {a.file_patterns.slice(0, 3).map((f) => (
                  <code key={f}>{f}</code>
                ))}
                {a.keywords.slice(0, 4).map((k) => (
                  <span key={k} className="tag">{k}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

type Tab = "analyze" | "library" | "areas";

export default function App() {
  const [tab, setTab] = useState<Tab>("analyze");
  const [health, setHealth] = useState<Health | null>(null);
  const [areas, setAreas] = useState<AreaInfo[]>([]);

  useEffect(() => {
    api.health().then(setHealth).catch(console.error);
    api.areas().then((r) => setAreas(r.areas)).catch(console.error);
  }, []);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">🧪</span>
          <div>
            <h1>TESTMCP</h1>
            <p>AI QA prediction layer for GitHub PRs</p>
          </div>
        </div>
        <nav>
          {(
            [
              ["analyze", "Analyze PR"],
              ["library", "Test Library"],
              ["areas", "Risk Areas"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="status">
          {health && (
            <span className={`pill ${health.github_token ? "ok" : "warn-pill"}`}>
              {health.github_token ? "● GitHub token" : "○ no token"}
            </span>
          )}
          <span className="pill">v{health?.version ?? "…"}</span>
        </div>
      </header>
      <main>
        {tab === "analyze" && <AnalyzeView tokenPresent={health?.github_token ?? false} />}
        {tab === "library" && <LibraryView areas={areas} />}
        {tab === "areas" && <AreasView areas={areas} />}
      </main>
      <footer>TestMCP · test case management as a prediction layer · complements your existing repo agents</footer>
    </div>
  );
}
