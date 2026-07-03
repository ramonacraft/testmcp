/** Loads and manages the YAML test case library. */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { LIBRARY_DIR, CUSTOM_LIBRARY_FILE } from "../constants.js";
import type { Mappings, Priority, TestCase } from "../types.js";

const CASE_FILES = [
  "p0-critical.yaml",
  "p1-high.yaml",
  "p2-medium.yaml",
  "p3-low.yaml",
  "custom.yaml",
];

let cachedCases: TestCase[] | null = null;
let cachedMappings: Mappings | null = null;

export function loadTestCases(forceReload = false): TestCase[] {
  if (cachedCases && !forceReload) return cachedCases;

  const cases: TestCase[] = [];
  for (const file of CASE_FILES) {
    const fullPath = path.join(LIBRARY_DIR, file);
    if (!fs.existsSync(fullPath)) continue;
    const raw = fs.readFileSync(fullPath, "utf8");
    const parsed = YAML.parse(raw) as { test_cases?: TestCase[] } | null;
    for (const tc of parsed?.test_cases ?? []) {
      cases.push({ ...tc, source: file });
    }
  }
  cachedCases = cases;
  return cases;
}

export function loadMappings(forceReload = false): Mappings {
  if (cachedMappings && !forceReload) return cachedMappings;
  const fullPath = path.join(LIBRARY_DIR, "mappings.yaml");
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `mappings.yaml not found in library directory '${LIBRARY_DIR}'. ` +
        `Set TESTMCP_LIBRARY_DIR to a directory containing mappings.yaml and the test case YAML files.`
    );
  }
  const raw = fs.readFileSync(fullPath, "utf8");
  cachedMappings = YAML.parse(raw) as Mappings;
  return cachedMappings;
}

export function invalidateCache(): void {
  cachedCases = null;
  cachedMappings = null;
}

/** Generates the next sequential custom test case ID (TC-CUST-###). */
export function nextCustomId(): string {
  const existing = loadTestCases(true)
    .map((tc) => /^TC-CUST-(\d+)$/.exec(tc.id))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => parseInt(m[1], 10));
  const next = existing.length ? Math.max(...existing) + 1 : 1;
  return `TC-CUST-${String(next).padStart(3, "0")}`;
}

/** Appends a test case to custom.yaml (creating the file if needed). */
export function appendCustomCase(tc: TestCase): void {
  let doc: { test_cases: TestCase[] } = { test_cases: [] };
  if (fs.existsSync(CUSTOM_LIBRARY_FILE)) {
    const parsed = YAML.parse(fs.readFileSync(CUSTOM_LIBRARY_FILE, "utf8"));
    if (parsed?.test_cases) doc = parsed;
  }
  const { source: _source, ...clean } = tc;
  doc.test_cases.push(clean as TestCase);
  const header =
    "# TestMCP Test Case Library — Custom cases added via testmcp_add_test_case\n";
  fs.writeFileSync(CUSTOM_LIBRARY_FILE, header + YAML.stringify(doc), "utf8");
  invalidateCache();
}

export function filterCases(opts: {
  priority?: Priority;
  area?: string;
  platform?: string;
  tag?: string;
}): TestCase[] {
  return loadTestCases().filter((tc) => {
    if (opts.priority && tc.priority !== opts.priority) return false;
    if (opts.area && tc.area !== opts.area) return false;
    if (opts.platform && !tc.platforms.includes(opts.platform as never)) return false;
    if (opts.tag && !tc.tags.includes(opts.tag)) return false;
    return true;
  });
}

export function searchCases(query: string): TestCase[] {
  const q = query.toLowerCase();
  return loadTestCases().filter((tc) => {
    const haystack = [
      tc.id,
      tc.title,
      tc.area,
      tc.expected,
      tc.preconditions ?? "",
      ...tc.tags,
      ...tc.steps,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
