import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Directory containing the YAML test case library.
 * Defaults to <monorepo root>/library (resolved from packages/core/dist).
 * Override with TESTMCP_LIBRARY_DIR to point TestMCP at a team-specific library.
 */
export const LIBRARY_DIR =
  process.env.TESTMCP_LIBRARY_DIR ??
  path.resolve(__dirname, "..", "..", "..", "library");

/** File that testmcp_add_test_case writes to. */
export const CUSTOM_LIBRARY_FILE = path.join(LIBRARY_DIR, "custom.yaml");

/** Maximum characters returned by any tool before truncation. */
export const CHARACTER_LIMIT = 25000;

export const PRIORITY_WEIGHT: Record<string, number> = {
  P0: 4,
  P1: 3,
  P2: 2,
  P3: 1,
};

export const SERVER_NAME = "testmcp-server";
export const SERVER_VERSION = "0.2.0";
