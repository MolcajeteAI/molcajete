import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ResolveConflictsOutput } from "../types.js";
import { MODEL, RESOLVE_CONFLICTS_SCHEMA } from "./config.js";
import { log } from "./utils.js";

export interface GitResult {
  status: "success" | "failure";
  commit?: string;
  error?: string;
}

export interface MergeOptions {
  ffOnly?: boolean;
  cwd?: string;
}

// ── Helpers ──

function head(cwd: string): string {
  return execSync("git rev-parse HEAD", { cwd, stdio: "pipe" }).toString().trim();
}

function hasConflicts(cwd: string): boolean {
  const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString();
  return /^(UU|AA|DD|AU|UA|DU|UD) /m.test(status);
}

function conflictedFiles(cwd: string): string[] {
  const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString();
  const files: string[] = [];
  for (const line of status.split("\n")) {
    if (/^(UU|AA|DD|AU|UA|DU|UD) /.test(line)) {
      files.push(line.slice(3));
    }
  }
  return files;
}

function detectOperation(cwd: string): "merge" | "rebase" | null {
  const gitDir = execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" }).toString().trim();
  if (existsSync(resolve(cwd, gitDir, "MERGE_HEAD"))) return "merge";
  if (existsSync(resolve(cwd, gitDir, "rebase-merge")) || existsSync(resolve(cwd, gitDir, "rebase-apply")))
    return "rebase";
  return null;
}

async function spawnClaudeResolve(
  cwd: string,
  payload: Record<string, unknown>,
  sessionLabel: string,
): Promise<ResolveConflictsOutput> {
  // Lazy import to avoid circular dependency with CLI-only code
  const { invokeClaude, extractStructuredOutput } = await import("../commands/lib/claude.js");

  const result = await invokeClaude(cwd, [
    "--model",
    MODEL,
    "--allowedTools",
    "Read,Write,Edit,Glob,Grep,Bash",
    "--max-turns",
    "30",
    "--json-schema",
    JSON.stringify(RESOLVE_CONFLICTS_SCHEMA),
    "--name",
    sessionLabel,
    `/molcajete:resolve-conflicts ${JSON.stringify(payload)}`,
  ]);

  return extractStructuredOutput(result.output) as unknown as ResolveConflictsOutput;
}

// ── Worktree Operations ──

export interface WorktreeResult {
  ok: boolean;
  error?: string;
}

export interface MergeWorktreeResult {
  ok: boolean;
  error?: string;
}

export interface CommitResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Fetch the base branch from the remote. The user's local <baseBranch> ref
 * is never touched; only refs/remotes/<remote>/<baseBranch> is updated.
 *
 * Hard-fails if the remote is missing, the fetch fails, or the remote branch
 * doesn't exist. Dispatch requires a working remote — the remote is the
 * source of truth for every worktree's base.
 */
export function fetchBase(projectRoot: string, remote: string, baseBranch: string): WorktreeResult {
  try {
    execSync(`git remote get-url ${remote}`, { cwd: projectRoot, stdio: "pipe" });
  } catch {
    return { ok: false, error: `remote '${remote}' is not configured` };
  }

  try {
    execSync(`git fetch ${remote} ${baseBranch}`, { cwd: projectRoot, stdio: "pipe" });
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    return { ok: false, error: `git fetch ${remote} ${baseBranch} failed: ${msg}` };
  }

  try {
    execSync(`git rev-parse --verify --quiet refs/remotes/${remote}/${baseBranch}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    return { ok: false, error: `${remote}/${baseBranch} does not exist after fetch` };
  }

  return { ok: true };
}

/**
 * Rebase the current branch (inside a worktree) onto <remote>/<baseBranch>.
 * Runs a fresh fetch first so the rebase target is the freshest remote tip.
 *
 * Called before every write stage — dev sessions, retry cycles, and the
 * final merge — so task work is always integrated with the latest remote
 * state before the next commit lands.
 */
export async function rebaseOnRemoteBase(
  worktreePath: string,
  remote: string,
  baseBranch: string,
  sessionLabel?: string,
): Promise<WorktreeResult> {
  try {
    execSync(`git remote get-url ${remote}`, { cwd: worktreePath, stdio: "pipe" });
  } catch {
    return { ok: false, error: `remote '${remote}' is not configured` };
  }

  try {
    execSync(`git fetch ${remote} ${baseBranch}`, { cwd: worktreePath, stdio: "pipe" });
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    return { ok: false, error: `git fetch ${remote} ${baseBranch} failed: ${msg}` };
  }

  let branch: string;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: worktreePath, stdio: "pipe" }).toString().trim();
  } catch (err) {
    return { ok: false, error: `could not resolve HEAD in worktree: ${(err as Error).message}` };
  }
  if (branch === "HEAD") {
    return { ok: false, error: "worktree is in detached HEAD — cannot rebase" };
  }

  const result = await rebase(`${remote}/${baseBranch}`, branch, {
    cwd: worktreePath,
    sessionLabel: sessionLabel ?? `rebase-${branch}`,
  });
  if (result.status === "failure") {
    return { ok: false, error: `rebase of ${branch} onto ${remote}/${baseBranch} failed: ${result.error}` };
  }
  return { ok: true };
}

/**
 * Fast-forward push the worktree's current branch onto <baseBranch> on the
 * remote. Races are handled by fetching + rebasing + retrying up to
 * maxRetries times; a terminal failure is returned as { ok: false }.
 *
 * Precondition: caller has already rebased on <remote>/<baseBranch> — the
 * first push attempt is expected to succeed under normal conditions.
 */
export async function pushToRemoteBase(
  worktreePath: string,
  remote: string,
  baseBranch: string,
  maxRetries = 3,
): Promise<WorktreeResult> {
  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync(`git push ${remote} HEAD:${baseBranch}`, { cwd: worktreePath, stdio: "pipe" });
      return { ok: true };
    } catch (err) {
      lastError = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
      if (attempt === maxRetries) break;

      // Rejection (non-ff) → re-fetch, re-rebase, retry
      const rebased = await rebaseOnRemoteBase(worktreePath, remote, baseBranch, `push-retry-${attempt}`);
      if (!rebased.ok) {
        return { ok: false, error: `push retry ${attempt} failed to rebase: ${rebased.error}` };
      }
    }
  }
  return { ok: false, error: `git push ${remote} HEAD:${baseBranch} failed after ${maxRetries} attempts: ${lastError}` };
}

/**
 * Create a git worktree with a new branch.
 *
 * Default (resume=false): fetch <remote>/<baseBranch> must have already been
 * run (see fetchBase). The new branch is created from <remote>/<baseBranch>
 * so the worktree always starts from the freshest remote tip — the local
 * <baseBranch> ref is never touched.
 *
 * Resume (resume=true): the task's branch is assumed to already exist —
 * locally, or on the remote from a prior push. Never branch off the base
 * (that would silently discard prior work).
 */
export function createWorktree(
  projectRoot: string,
  branchName: string,
  worktreePath: string,
  baseBranch: string,
  opts: { resume?: boolean; remote?: string } = {},
): WorktreeResult {
  const resume = opts.resume ?? false;
  const remote = opts.remote ?? "origin";

  // Worktree already registered at this path?
  const existing = findRegisteredWorktree(projectRoot, worktreePath);
  if (existing === branchName) {
    // Correct branch attached — assume up to date, no-op.
    return { ok: true };
  }
  if (existing) {
    // Wrong branch attached — force-remove and fall through to recreate.
    try {
      execSync(`git worktree remove --force ${worktreePath}`, { cwd: projectRoot, stdio: "pipe" });
    } catch {
      /* best-effort removal */
    }
  }

  if (resume) {
    // Resume: attach to existing branch (local or remote). Never branch off baseBranch.
    if (!localBranchExists(projectRoot, branchName)) {
      if (!fetchRemoteBranch(projectRoot, remote, branchName)) {
        return {
          ok: false,
          error: `--resume: branch ${branchName} not found locally or on remote ${remote}`,
        };
      }
    }
    try {
      execSync(`git worktree add ${worktreePath} ${branchName}`, { cwd: projectRoot, stdio: "pipe" });
      return { ok: true };
    } catch (err) {
      const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
      return { ok: false, error: msg };
    }
  }

  const baseRef = `${remote}/${baseBranch}`;
  try {
    execSync(`git worktree add -b ${branchName} ${worktreePath} ${baseRef}`, { cwd: projectRoot, stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();

    // Branch already exists locally from a prior run — reuse it.
    if (/already exists/i.test(msg)) {
      try {
        execSync(`git worktree add ${worktreePath} ${branchName}`, { cwd: projectRoot, stdio: "pipe" });
        return { ok: true };
      } catch (err2) {
        const msg2 = ((err2 as { stderr?: Buffer }).stderr?.toString() ?? (err2 as Error).message).trim();
        return { ok: false, error: msg2 };
      }
    }

    return { ok: false, error: msg };
  }
}

/**
 * Parse `git worktree list --porcelain` and return the branch name
 * if the given path is already registered, or null if not found.
 */
function findRegisteredWorktree(projectRoot: string, worktreePath: string): string | null {
  let output: string;
  try {
    output = execSync("git worktree list --porcelain", { cwd: projectRoot, stdio: "pipe" }).toString();
  } catch {
    return null;
  }

  const absPath = resolve(worktreePath);

  for (const block of output.split("\n\n")) {
    const lines = block.trim().split("\n");
    const wtLine = lines.find((l) => l.startsWith("worktree "));
    if (!wtLine) continue;
    const wtPath = resolve(wtLine.slice("worktree ".length));
    if (wtPath !== absPath) continue;

    const branchLine = lines.find((l) => l.startsWith("branch "));
    if (!branchLine) return null; // detached HEAD — treat as wrong branch
    return branchLine.slice("branch refs/heads/".length);
  }
  return null;
}

/**
 * Remove a git worktree and delete its branch (safe delete).
 * Non-fatal: logs warnings on failure.
 */
export function removeWorktree(projectRoot: string, worktreePath: string, branchName: string): void {
  try {
    execSync(`git worktree remove ${worktreePath} --force`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    log(`Warning: failed to remove worktree ${worktreePath}: ${msg}`);
  }

  try {
    execSync(`git branch -d ${branchName}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    log(`Warning: failed to delete local branch ${branchName}: ${msg}`);
  }

  // Delete the remote branch if it exists
  try {
    execSync(`git push origin --delete ${branchName}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    // Remote branch may not exist (push was never enabled) — ignore silently
  }
}

/**
 * Merge a worktree branch into <baseBranch> by pushing directly to the remote.
 *
 * Flow (entirely inside the worktree — projectRoot is never touched):
 *   1. Rebase the worktree branch onto <remote>/<baseBranch>. On conflict,
 *      Claude is invoked to resolve.
 *   2. Push HEAD to <remote>/<baseBranch>. On rejection (remote advanced
 *      mid-push), re-fetch + re-rebase + retry.
 *
 * The remote is the merge point. The user's local <baseBranch> ref is never
 * updated — if they want to mirror remote locally, they `git pull` themselves.
 */
export async function mergeWorktreeBranch(
  _projectRoot: string,
  branchName: string,
  baseBranch: string,
  worktreePath: string,
  remote: string,
): Promise<MergeWorktreeResult> {
  const rebased = await rebaseOnRemoteBase(worktreePath, remote, baseBranch, `rebase-${branchName}`);
  if (!rebased.ok) {
    return { ok: false, error: rebased.error };
  }

  const pushed = await pushToRemoteBase(worktreePath, remote, baseBranch);
  if (!pushed.ok) {
    return { ok: false, error: pushed.error };
  }

  return { ok: true };
}

/**
 * Stage a single file and commit it with the given message.
 * Returns { ok: true, skipped: true } when the file is unchanged from HEAD.
 *
 * Restricts both staging and commit to the given pathspec so unrelated
 * working-tree changes (the user's in-flight work in the main checkout) are
 * never swept into a dispatch-driven commit.
 *
 * Used for plan.json bookkeeping commits both on the main checkout
 * (pre/post-task plan-level updates) and inside a worktree (per-task
 * progress flushed before merge). Keeping these commits out of an
 * uncommitted working tree is what makes --ff-only merges always succeed.
 */
export function commitPlanFile(cwd: string, planFile: string, message: string): CommitResult {
  const stage = spawnSync("git", ["add", "--", planFile], { cwd, stdio: "pipe" });
  if (stage.status !== 0) {
    const detail =
      stage.stderr.toString().trim() || stage.stdout.toString().trim() || stage.error?.message || "unknown error";
    return { ok: false, error: `git add failed: ${detail}` };
  }

  // Check whether this specific path has staged changes. Other paths may be
  // staged independently (rare, but possible) — we don't care about those.
  const diff = spawnSync("git", ["diff", "--cached", "--quiet", "--", planFile], { cwd, stdio: "pipe" });
  if (diff.status === 0) {
    return { ok: true, skipped: true };
  }

  const result = spawnSync("git", ["commit", "-m", message, "--only", "--", planFile], { cwd, stdio: "pipe" });
  if (result.status !== 0) {
    const detail =
      result.stderr.toString().trim() || result.stdout.toString().trim() || result.error?.message || "unknown error";
    return { ok: false, error: `git commit failed: ${detail}` };
  }
  return { ok: true };
}

export interface PushResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Push the current branch to the given remote.
 *
 * - Detached HEAD → skip (warning)
 * - Remote missing → skip (warning)
 * - Missing upstream → retry once with `-u`
 * - Other failures → { ok: false, error }
 *
 * Never throws.
 */
export function pushCurrentBranch(remote: string, cwd?: string): PushResult {
  const execOpts = { stdio: "pipe" as const, ...(cwd && { cwd }) };

  // Resolve current branch
  let branch: string;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", execOpts).toString().trim();
  } catch (err) {
    return { ok: false, skipped: true, error: `could not resolve HEAD: ${(err as Error).message}` };
  }

  if (branch === "HEAD") {
    return { ok: false, skipped: true, error: "detached HEAD" };
  }

  // Verify remote exists
  try {
    execSync(`git remote get-url ${remote}`, execOpts);
  } catch {
    return { ok: false, skipped: true, error: `no remote '${remote}'` };
  }

  // Attempt push
  try {
    execSync(`git push ${remote} HEAD`, execOpts);
    return { ok: true };
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    // Retry once with -u for missing upstream
    if (/has no upstream branch|set-upstream|--set-upstream/i.test(msg)) {
      try {
        execSync(`git push -u ${remote} HEAD`, execOpts);
        return { ok: true };
      } catch (err2) {
        const msg2 = ((err2 as { stderr?: Buffer }).stderr?.toString() ?? (err2 as Error).message).trim();
        return { ok: false, error: msg2 };
      }
    }
    return { ok: false, error: msg };
  }
}

/**
 * Check whether a local branch exists.
 */
function localBranchExists(projectRoot: string, branchName: string): boolean {
  try {
    execSync(`git rev-parse --verify --quiet refs/heads/${branchName}`, { cwd: projectRoot, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch a remote branch into a local tracking branch of the same name.
 * Returns true on success, false if the ref doesn't exist on the remote.
 */
function fetchRemoteBranch(projectRoot: string, remote: string, branchName: string): boolean {
  try {
    execSync(`git fetch ${remote} ${branchName}:${branchName}`, { cwd: projectRoot, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── Public API ──

export async function merge(_base: string, branch: string, options?: MergeOptions): Promise<GitResult> {
  const ffOnly = options?.ffOnly ?? true;
  const cwd = options?.cwd ?? process.cwd();

  try {
    if (ffOnly) {
      try {
        execSync(`git merge --ff-only ${branch}`, { cwd, stdio: "pipe" });
        return { status: "success", commit: head(cwd) };
      } catch {
        return { status: "failure", error: "Not fast-forwardable — rebase first" };
      }
    }

    // Non-ff merge
    try {
      execSync(`git merge ${branch}`, { cwd, stdio: "pipe" });
      return { status: "success", commit: head(cwd) };
    } catch {
      if (!hasConflicts(cwd)) {
        return { status: "failure", error: "Merge failed (no conflicts detected)" };
      }

      const result = await resolveConflicts({ cwd });

      if (result.status === "failure") {
        try {
          execSync("git merge --abort", { cwd, stdio: "pipe" });
        } catch {
          /* already clean */
        }
        return result;
      }

      return result;
    }
  } catch (err) {
    return { status: "failure", error: (err as Error).message };
  }
}

export async function rebase(
  onto: string,
  branch: string,
  opts: { cwd?: string; sessionLabel?: string } = {},
): Promise<GitResult> {
  const cwd = opts.cwd ?? process.cwd();

  try {
    execSync(`git checkout ${branch}`, { cwd, stdio: "pipe" });
  } catch (err) {
    return { status: "failure", error: `Failed to checkout ${branch}: ${(err as Error).message}` };
  }

  try {
    execSync(`git rebase ${onto}`, { cwd, stdio: "pipe" });
    return { status: "success", commit: head(cwd) };
  } catch {
    if (!hasConflicts(cwd)) {
      try {
        execSync("git rebase --abort", { cwd, stdio: "pipe" });
      } catch {
        /* already clean */
      }
      return { status: "failure", error: "Rebase failed (no conflicts detected)" };
    }

    const result = await resolveConflicts({ cwd, sessionLabel: opts.sessionLabel });

    if (result.status === "failure") {
      try {
        execSync("git rebase --abort", { cwd, stdio: "pipe" });
      } catch {
        /* already clean */
      }
      return result;
    }

    return result;
  }
}

export async function resolveConflicts(opts: { cwd?: string; sessionLabel?: string } = {}): Promise<GitResult> {
  const cwd = opts.cwd ?? process.cwd();
  const files = conflictedFiles(cwd);

  if (files.length === 0) {
    return { status: "failure", error: "No conflicts detected" };
  }

  const operation = detectOperation(cwd);
  if (!operation) {
    return { status: "failure", error: "No merge or rebase in progress" };
  }

  // Gather ref info for context
  let baseRef = "";
  let incomingRef = "";
  try {
    if (operation === "merge") {
      baseRef = execSync("git rev-parse HEAD", { cwd, stdio: "pipe" }).toString().trim();
      incomingRef = execSync("git rev-parse MERGE_HEAD", { cwd, stdio: "pipe" }).toString().trim();
    } else {
      const gitDir = execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" }).toString().trim();
      baseRef = execSync(`cat ${gitDir}/rebase-merge/onto`, { cwd, stdio: "pipe" }).toString().trim();
      incomingRef = execSync("git rev-parse HEAD", { cwd, stdio: "pipe" }).toString().trim();
    }
  } catch {
    /* non-fatal — Claude can still resolve without refs */
  }

  const payload = {
    conflicted_files: files,
    operation,
    base_ref: baseRef,
    incoming_ref: incomingRef,
  };

  const output = await spawnClaudeResolve(cwd, payload, opts.sessionLabel ?? "resolve-conflicts");

  if (output.status !== "resolved") {
    return { status: "failure", error: output.error || "Conflict resolution failed" };
  }

  // Complete the operation
  try {
    if (operation === "merge") {
      execSync("git commit --no-edit", { cwd, stdio: "pipe" });
    } else {
      execSync("git rebase --continue", { cwd, stdio: "pipe", env: { ...process.env, GIT_EDITOR: "true" } });
    }
    return { status: "success", commit: head(cwd) };
  } catch (err) {
    return { status: "failure", error: `Failed to complete ${operation}: ${(err as Error).message}` };
  }
}
