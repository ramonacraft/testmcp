/** GitHub API client — fetches PR metadata and changed files. */

import { Octokit } from "@octokit/rest";
import type { ChangedFile, PrInfo } from "../types.js";

let octokit: Octokit | null = null;

function getClient(): Octokit {
  if (!octokit) {
    const auth = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    octokit = new Octokit(auth ? { auth } : {});
  }
  return octokit;
}

export function handleGitHubError(error: unknown, context: string): string {
  const err = error as { status?: number; message?: string };
  switch (err.status) {
    case 401:
      return `Error: GitHub authentication failed while ${context}. Set a valid GITHUB_TOKEN environment variable (a fine-grained PAT with 'Pull requests: read' and 'Contents: read' permissions).`;
    case 403:
      return `Error: GitHub permission denied or rate limit exceeded while ${context}. If the repo is private, ensure GITHUB_TOKEN has access to it.`;
    case 404:
      return `Error: Not found while ${context}. Check the owner, repo, and PR number are correct — and that GITHUB_TOKEN can see the repository if it is private.`;
    default:
      return `Error: GitHub request failed while ${context}: ${err.message ?? String(error)}`;
  }
}

export async function fetchPullRequest(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrInfo> {
  const client = getClient();

  const { data: pr } = await client.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  const files: ChangedFile[] = await client.paginate(
    client.pulls.listFiles,
    { owner, repo, pull_number: prNumber, per_page: 100 },
    (response) =>
      response.data.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        ...(f.previous_filename ? { previous_filename: f.previous_filename } : {}),
      }))
  );

  return {
    owner,
    repo,
    number: prNumber,
    title: pr.title,
    body: pr.body ?? "",
    author: pr.user?.login ?? "unknown",
    base_branch: pr.base.ref,
    head_branch: pr.head.ref,
    state: pr.state,
    draft: pr.draft ?? false,
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files_count: pr.changed_files,
    labels: pr.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
    url: pr.html_url,
    files,
  };
}
