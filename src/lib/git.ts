import { execSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { PlanData, ResolveConflictsOutput, Task } from "../types.js";
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

function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function head(cwd: string): string {
  return execSync("git rev-parse HEAD", { cwd, stdio: "pipe" }).toString().trim();
}

function hasConflicts(cwd: string): boolean {
  const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString();
  return /^(UU|AA|DD|AU|UA|DU|UD) /m.test(status);
}

function isWorkingTreeDirty(cwd: string): boolean {
  const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString().trim();
  return status.length > 0;
}

const STASH_MESSAGE = "molcajete-auto-stash";

/**
 * Stash the working tree (including untracked files) when dirty. Returns
 * `{ stashed: true }` when a stash was created, `{ stashed: false }` when
 * nothing needed stashing. On failure, returns an error.
 */
function stashIfDirty(cwd: string): { ok: boolean; stashed: boolean; error?: string } {
  if (!isWorkingTreeDirty(cwd)) return { ok: true, stashed: false };
  try {
    execSync(`git stash push -u -m "${STASH_MESSAGE}"`, { cwd, stdio: "pipe" });
    return { ok: true, stashed: true };
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    return { ok: false, stashed: false, error: `git stash push failed: ${msg}` };
  }
}

/**
 * Pop the most recent stash. On conflict, auto-resolve: plan.json prefers the
 * current branch (the rebased remote state), every other file prefers the
 * stash (the worker's uncommitted work). After resolution, the stash entry
 * is dropped so the worktree ends in a clean, non-stashed state.
 *
 * Rationale: plan.json stage updates written inside the cycle are transient
 * and always superseded by subsequent writes, so the rebased version wins.
 * Code edits from a partial dev session are the worker's actual in-flight
 * work and must be preserved.
 */
function popStash(cwd: string): WorktreeResult {
  try {
    execSync("git stash pop", { cwd, stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    const popStderr = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    const conflicted = conflictedFiles(cwd);
    if (conflicted.length === 0) {
      return { ok: false, error: `git stash pop failed: ${popStderr}` };
    }

    try {
      for (const f of conflicted) {
        const side = f.endsWith("plan.json") ? "--ours" : "--theirs";
        execSync(`git checkout ${side} -- ${shellEscape(f)}`, { cwd, stdio: "pipe" });
        execSync(`git reset -- ${shellEscape(f)}`, { cwd, stdio: "pipe" });
      }
      execSync("git stash drop", { cwd, stdio: "pipe" });
      return { ok: true };
    } catch (err2) {
      const msg = ((err2 as { stderr?: Buffer }).stderr?.toString() ?? (err2 as Error).message).trim();
      return { ok: false, error: `stash pop conflict resolution failed: ${msg}` };
    }
  }
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
 *
 * Dirty working trees are handled transparently: any pending changes are
 * stashed before the rebase and restored after. Stash-pop conflicts are
 * auto-resolved (plan.json prefers rebased; other files prefer stash).
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

  const stash = stashIfDirty(worktreePath);
  if (!stash.ok) {
    return { ok: false, error: stash.error };
  }

  const result = await rebase(`${remote}/${baseBranch}`, branch, {
    cwd: worktreePath,
    sessionLabel: sessionLabel ?? `rebase-${branch}`,
  });

  if (result.status === "failure") {
    if (stash.stashed) {
      const restored = popStash(worktreePath);
      if (!restored.ok) {
        return {
          ok: false,
          error: `rebase of ${branch} onto ${remote}/${baseBranch} failed: ${result.error} (stash restore also failed: ${restored.error})`,
        };
      }
    }
    return { ok: false, error: `rebase of ${branch} onto ${remote}/${baseBranch} failed: ${result.error}` };
  }

  if (stash.stashed) {
    const restored = popStash(worktreePath);
    if (!restored.ok) {
      return { ok: false, error: `rebase succeeded but stash restore failed: ${restored.error}` };
    }
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

  // ── Step 1: Clean up stale worktree registrations ──
  // Check if the target path already has a worktree registered.
  const existingAtPath = findRegisteredWorktree(projectRoot, worktreePath);
  if (existingAtPath === branchName) {
    // Correct branch at correct path — reuse as-is.
    return { ok: true };
  }
  if (existingAtPath) {
    // Wrong branch at this path — remove and recreate.
    forceRemoveWorktree(projectRoot, worktreePath);
  }

  // Check if the branch is checked out in a DIFFERENT worktree (stale leftover).
  const staleWorktreePath = findWorktreeByBranch(projectRoot, branchName);
  if (staleWorktreePath && resolve(staleWorktreePath) !== resolve(worktreePath)) {
    forceRemoveWorktree(projectRoot, staleWorktreePath);
  }

  // ── Step 2: Resume path ──
  if (resume) {
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

  // ── Step 3: Fresh worktree from baseBranch ──
  // Delete stale remote branch from a prior run so the first push won't
  // hit a non-fast-forward rejection.
  try {
    execSync(`git push ${remote} --delete ${branchName}`, { cwd: projectRoot, stdio: "pipe" });
  } catch {
    /* branch may not exist on remote — that's fine */
  }

  // Delete stale local branch if it exists (now safe — any worktree using it
  // was removed in step 1).
  if (localBranchExists(projectRoot, branchName)) {
    try {
      execSync(`git branch -D ${branchName}`, { cwd: projectRoot, stdio: "pipe" });
    } catch {
      /* best-effort */
    }
  }

  const baseRef = `${remote}/${baseBranch}`;
  try {
    execSync(`git worktree add -b ${branchName} ${worktreePath} ${baseRef}`, { cwd: projectRoot, stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    return { ok: false, error: msg };
  }
}

/**
 * Force-remove a worktree and prune its registration. Never throws.
 */
function forceRemoveWorktree(projectRoot: string, wtPath: string): void {
  try {
    execSync(`git worktree remove --force ${shellEscape(wtPath)}`, { cwd: projectRoot, stdio: "pipe" });
  } catch {
    // If remove fails (e.g., path already deleted), prune stale entries.
    try {
      execSync("git worktree prune", { cwd: projectRoot, stdio: "pipe" });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Parse `git worktree list --porcelain` and return the branch name
 * if the given path is already registered, or null if not found.
 */
function findRegisteredWorktree(projectRoot: string, worktreePath: string): string | null {
  const parsed = parseWorktreeList(projectRoot);
  const absPath = resolve(worktreePath);
  const entry = parsed.find((e) => e.path === absPath);
  if (!entry) return null;
  return entry.branch;
}

/**
 * Find the worktree path that has `branchName` checked out, or null if none.
 */
function findWorktreeByBranch(projectRoot: string, branchName: string): string | null {
  const parsed = parseWorktreeList(projectRoot);
  const entry = parsed.find((e) => e.branch === branchName);
  return entry?.path ?? null;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

function parseWorktreeList(projectRoot: string): WorktreeEntry[] {
  let output: string;
  try {
    output = execSync("git worktree list --porcelain", { cwd: projectRoot, stdio: "pipe" }).toString();
  } catch {
    return [];
  }

  const entries: WorktreeEntry[] = [];
  for (const block of output.split("\n\n")) {
    const lines = block.trim().split("\n");
    const wtLine = lines.find((l) => l.startsWith("worktree "));
    if (!wtLine) continue;
    const wtPath = resolve(wtLine.slice("worktree ".length));
    const branchLine = lines.find((l) => l.startsWith("branch "));
    entries.push({
      path: wtPath,
      branch: branchLine ? branchLine.slice("branch refs/heads/".length) : null,
    });
  }
  return entries;
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
 *      Claude is invoked to resolve. Plan.json-only conflicts are auto-resolved.
 *   2. If planRelPath is provided, reconcile plan.json so that only this
 *      task's fields override remote state (concurrent merges are commutative).
 *   3. Push HEAD to <remote>/<baseBranch>. On rejection (remote advanced
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
  opts: { taskId?: string; planRelPath?: string } = {},
): Promise<MergeWorktreeResult> {
  const rebased = await rebaseOnRemoteBase(worktreePath, remote, baseBranch, `rebase-${branchName}`);
  if (!rebased.ok) {
    return { ok: false, error: rebased.error };
  }

  // Reconcile plan.json: take remote's copy and overwrite only this task's
  // fields. Keeps concurrent merges commutative — remote always has a coherent
  // view of tasks that other workers have finished.
  if (opts.taskId && opts.planRelPath) {
    const reconciled = reconcilePlanFile(worktreePath, remote, baseBranch, opts.taskId, opts.planRelPath);
    if (!reconciled.ok) {
      return { ok: false, error: `plan.json reconcile failed: ${reconciled.error}` };
    }
  }

  const pushed = await pushToRemoteBase(worktreePath, remote, baseBranch);
  if (!pushed.ok) {
    return { ok: false, error: pushed.error };
  }

  return { ok: true };
}

/**
 * Overwrite the worktree's plan.json so only this task's entry wins; every
 * other task reflects `remote/<baseBranch>`'s latest state. Commits the result
 * on the worktree branch so the subsequent push carries only this task's
 * change. Called after the pre-push rebase.
 */
function reconcilePlanFile(
  worktreePath: string,
  remote: string,
  baseBranch: string,
  taskId: string,
  planRelPath: string,
): WorktreeResult {
  const absPlan = resolve(worktreePath, planRelPath);

  let remoteRaw: string;
  try {
    remoteRaw = execSync(`git show ${remote}/${baseBranch}:${planRelPath}`, {
      cwd: worktreePath,
      stdio: "pipe",
    }).toString();
  } catch (err) {
    return { ok: false, error: `failed to read remote plan.json: ${(err as Error).message}` };
  }

  let workerRaw: string;
  try {
    workerRaw = execSync(`git show HEAD:${planRelPath}`, { cwd: worktreePath, stdio: "pipe" }).toString();
  } catch (err) {
    return { ok: false, error: `failed to read worktree plan.json: ${(err as Error).message}` };
  }

  let remotePlan: PlanData;
  let workerPlan: PlanData;
  try {
    remotePlan = JSON.parse(remoteRaw);
    workerPlan = JSON.parse(workerRaw);
  } catch (err) {
    return { ok: false, error: `plan.json JSON parse failed: ${(err as Error).message}` };
  }

  const workerTask = workerPlan.tasks.find((t) => t.id === taskId);
  if (!workerTask) {
    // Nothing to merge back — skip write/commit.
    return { ok: true };
  }

  const idx = remotePlan.tasks.findIndex((t: Task) => t.id === taskId);
  if (idx >= 0) {
    remotePlan.tasks[idx] = workerTask;
  } else {
    remotePlan.tasks.push(workerTask);
  }

  try {
    writeFileSync(absPlan, `${JSON.stringify(remotePlan, null, 2)}\n`);
  } catch (err) {
    return { ok: false, error: `failed to write reconciled plan.json: ${(err as Error).message}` };
  }

  const commit = commitPlanFile(worktreePath, absPlan, `chore(plan): reconcile ${taskId} onto latest base`);
  if (!commit.ok) {
    return { ok: false, error: commit.error };
  }
  return { ok: true };
}

/**
 * Result of `checkBaseSync`: whether local and remote bases are in sync, and
 * what action the caller took (fast-forward / push / abort / proceed).
 */
export type BaseSyncOutcome =
  | { ok: true; action: "in-sync" | "fast-forwarded" | "pushed" }
  | { ok: false; reason: "wrong-branch" | "dirty" | "fetch-failed" | "diverged" | "declined"; message: string };

/**
 * Verify that projectRoot is on `baseBranch`, its working tree is clean (on
 * plan.json scope), and the local base is in sync with `<remote>/<baseBranch>`.
 *
 * On mismatch: invokes `onPrompt` with a question; the caller is responsible
 * for prompting the user. If the caller confirms (returns true), the function
 * performs the matching fast-forward or push. If the caller declines, returns
 * `{ ok: false, reason: "declined" }`.
 */
export async function checkBaseSync(
  projectRoot: string,
  remote: string,
  baseBranch: string,
  planRelPath: string,
  onPrompt: (question: string) => Promise<boolean>,
): Promise<BaseSyncOutcome> {
  let currentBranch: string;
  try {
    currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: projectRoot, stdio: "pipe" }).toString().trim();
  } catch (err) {
    return { ok: false, reason: "wrong-branch", message: `failed to resolve HEAD: ${(err as Error).message}` };
  }
  if (currentBranch !== baseBranch) {
    return {
      ok: false,
      reason: "wrong-branch",
      message: `current branch is '${currentBranch}', not base '${baseBranch}' — checkout base before building`,
    };
  }

  // plan.json must be clean (staged or unstaged changes would be pulled into
  // future plan writes and confuse resume).
  try {
    const status = execSync(`git status --porcelain -- ${planRelPath}`, { cwd: projectRoot, stdio: "pipe" })
      .toString()
      .trim();
    if (status) {
      return {
        ok: false,
        reason: "dirty",
        message: `${planRelPath} has uncommitted changes:\n${status}`,
      };
    }
  } catch (err) {
    return { ok: false, reason: "dirty", message: `failed to check status: ${(err as Error).message}` };
  }

  const fetched = fetchBase(projectRoot, remote, baseBranch);
  if (!fetched.ok) {
    return { ok: false, reason: "fetch-failed", message: fetched.error ?? "fetch failed" };
  }

  let local: string;
  let remoteSha: string;
  try {
    local = execSync("git rev-parse HEAD", { cwd: projectRoot, stdio: "pipe" }).toString().trim();
    remoteSha = execSync(`git rev-parse refs/remotes/${remote}/${baseBranch}`, { cwd: projectRoot, stdio: "pipe" })
      .toString()
      .trim();
  } catch (err) {
    return { ok: false, reason: "fetch-failed", message: `failed to read refs: ${(err as Error).message}` };
  }

  if (local === remoteSha) {
    return { ok: true, action: "in-sync" };
  }

  // Is local an ancestor of remote? (local behind remote — can FF)
  const localIsAncestor =
    spawnSync("git", ["merge-base", "--is-ancestor", local, remoteSha], { cwd: projectRoot, stdio: "pipe" }).status ===
    0;
  const remoteIsAncestor =
    spawnSync("git", ["merge-base", "--is-ancestor", remoteSha, local], { cwd: projectRoot, stdio: "pipe" }).status ===
    0;

  if (localIsAncestor) {
    const behindCount = countCommits(projectRoot, `${local}..${remoteSha}`);
    const ok = await onPrompt(
      `Local ${baseBranch} is behind ${remote}/${baseBranch} by ${behindCount} commit(s). Fast-forward local now?`,
    );
    if (!ok) {
      return { ok: false, reason: "declined", message: "declined to fast-forward local base" };
    }
    try {
      execSync(`git merge --ff-only ${remote}/${baseBranch}`, { cwd: projectRoot, stdio: "pipe" });
      return { ok: true, action: "fast-forwarded" };
    } catch (err) {
      const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
      return { ok: false, reason: "fetch-failed", message: `fast-forward failed: ${msg}` };
    }
  }

  if (remoteIsAncestor) {
    const aheadCount = countCommits(projectRoot, `${remoteSha}..${local}`);
    const ok = await onPrompt(
      `Local ${baseBranch} is ahead of ${remote}/${baseBranch} by ${aheadCount} commit(s). Push local to remote now?`,
    );
    if (!ok) {
      return { ok: false, reason: "declined", message: "declined to push local base to remote" };
    }
    try {
      execSync(`git push ${remote} HEAD:${baseBranch}`, { cwd: projectRoot, stdio: "pipe" });
      return { ok: true, action: "pushed" };
    } catch (err) {
      const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
      return { ok: false, reason: "fetch-failed", message: `push failed: ${msg}` };
    }
  }

  return {
    ok: false,
    reason: "diverged",
    message: `local ${baseBranch} and ${remote}/${baseBranch} have diverged — resolve manually before rerunning`,
  };
}

function countCommits(cwd: string, range: string): number {
  try {
    const out = execSync(`git rev-list --count ${range}`, { cwd, stdio: "pipe" }).toString().trim();
    return Number.parseInt(out, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Translate a plan file absolute path to the repo-relative path used by
 * `git show` / reconciliation.
 */
export function planRelativePath(projectRoot: string, planFile: string): string {
  return relative(projectRoot, planFile);
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

export interface EmergencyCommitResult {
  committed: boolean;
  pushed: boolean;
  error?: string;
}

/**
 * Best-effort commit + push of everything in the working tree, used when a
 * build is halting (SIGINT, SIGTERM, failed healthcheck). Stages all tracked
 * and untracked files, commits with the given WIP message, then pushes the
 * current branch to the remote. Never throws — errors are returned so the
 * caller can log and move on to the next worktree.
 *
 * Skips silently when the tree is clean. Does NOT touch plan.json specifically
 * or try to be selective; the intent is to rescue whatever work is in flight.
 */
export function emergencyCommitAndPush(
  cwd: string,
  remote: string,
  message: string,
): EmergencyCommitResult {
  let committed = false;

  try {
    const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString().trim();
    if (status) {
      try {
        execSync("git add -A", { cwd, stdio: "pipe" });
      } catch (err) {
        const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
        return { committed: false, pushed: false, error: `git add -A failed: ${msg}` };
      }

      try {
        execSync(`git commit -m ${shellEscape(message)}`, { cwd, stdio: "pipe" });
        committed = true;
      } catch (err) {
        const detail = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
        return { committed: false, pushed: false, error: `git commit failed: ${detail}` };
      }
    }
  } catch (err) {
    return { committed: false, pushed: false, error: `git status failed: ${(err as Error).message}` };
  }

  const push = pushCurrentBranchSync(remote, cwd);
  if (!push.ok) {
    return { committed, pushed: false, error: push.error };
  }
  return { committed, pushed: true };
}

export interface PushResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Push the current branch to the given remote (sync, best-effort).
 * Used only by `emergencyCommitAndPush` in signal-handler paths where
 * async is not available. For normal pushes, use `pushCurrentBranch`.
 *
 * Never throws.
 */
export function pushCurrentBranchSync(remote: string, cwd?: string): PushResult {
  const execOpts = { stdio: "pipe" as const, ...(cwd && { cwd }) };

  let branch: string;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", execOpts).toString().trim();
  } catch (err) {
    return { ok: false, skipped: true, error: `could not resolve HEAD: ${(err as Error).message}` };
  }

  if (branch === "HEAD") {
    return { ok: false, skipped: true, error: "detached HEAD" };
  }

  try {
    execSync(`git remote get-url ${remote}`, execOpts);
  } catch {
    return { ok: false, skipped: true, error: `no remote '${remote}'` };
  }

  try {
    execSync(`git push ${remote} HEAD`, execOpts);
    return { ok: true };
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
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
 * Push the current branch to the given remote.
 *
 * On non-fast-forward rejection: fetches the remote branch, rebases onto it
 * (with Claude conflict resolution if needed), and retries — up to 3 attempts.
 *
 * - Detached HEAD → skip (warning)
 * - Remote missing → skip (warning)
 * - Missing upstream → retry once with `-u`
 * - Non-fast-forward → fetch + rebase + retry (up to 3 times)
 *
 * Never throws.
 */
export async function pushCurrentBranch(remote: string, cwd?: string): Promise<PushResult> {
  const execOpts = { stdio: "pipe" as const, ...(cwd && { cwd }) };
  const effectiveCwd = cwd ?? process.cwd();

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

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // First attempt: try with -u in case upstream is missing
    const pushCmd = attempt === 1 ? `git push -u ${remote} HEAD` : `git push ${remote} HEAD`;
    try {
      execSync(pushCmd, execOpts);
      return { ok: true };
    } catch (err) {
      const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();

      // Non-fast-forward → fetch + rebase + retry
      if (/non-fast-forward|rejected.*behind|failed to push/i.test(msg)) {
        if (attempt === maxAttempts) {
          return { ok: false, error: `push failed after ${maxAttempts} attempts: ${msg}` };
        }

        // Fetch the remote branch
        try {
          execSync(`git fetch ${remote} ${branch}`, execOpts);
        } catch (fetchErr) {
          const fetchMsg = ((fetchErr as { stderr?: Buffer }).stderr?.toString() ?? (fetchErr as Error).message).trim();
          return { ok: false, error: `fetch ${remote}/${branch} failed: ${fetchMsg}` };
        }

        // Rebase onto the remote branch (uses Claude for conflict resolution)
        const rebased = await rebase(`${remote}/${branch}`, branch, {
          cwd: effectiveCwd,
          sessionLabel: `push-retry-${branch}-${attempt}`,
        });
        if (rebased.status === "failure") {
          return { ok: false, error: `rebase onto ${remote}/${branch} failed: ${rebased.error}` };
        }

        continue;
      }

      // Other errors are terminal
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: "push failed: unexpected loop exit" };
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

  let rebaseStderr = "";
  try {
    execSync(`git rebase ${onto}`, { cwd, stdio: "pipe" });
    return { status: "success", commit: head(cwd) };
  } catch (err) {
    rebaseStderr = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    if (!hasConflicts(cwd)) {
      try {
        execSync("git rebase --abort", { cwd, stdio: "pipe" });
      } catch {
        /* already clean */
      }
      const detail = rebaseStderr ? `: ${rebaseStderr}` : "";
      return { status: "failure", error: `Rebase failed (no conflicts detected)${detail}` };
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

type AutoResolveResult =
  | { status: "success"; commit: string }
  | { status: "failure"; error: string }
  | { status: "needs_claude" };

/**
 * Loop through rebase steps, auto-resolving plan.json-only conflicts by
 * accepting theirs. Stops when:
 * - The rebase completes successfully → "success"
 * - A step has non-plan.json conflicts → "needs_claude" (caller falls through)
 * - An unexpected error occurs → "failure"
 *
 * For merge operations (non-rebase), resolves once and completes.
 */
async function autoResolvePlanJsonConflicts(
  cwd: string,
  operation: "merge" | "rebase",
  sessionLabel?: string,
): Promise<AutoResolveResult> {
  const MAX_STEPS = 100; // safety limit for very large rebases

  for (let step = 0; step < MAX_STEPS; step++) {
    const currentFiles = conflictedFiles(cwd);
    if (currentFiles.length === 0) {
      // No conflicts — rebase may have finished or this step is clean.
      return { status: "success", commit: head(cwd) };
    }

    const allPlan = currentFiles.every((f) => f.endsWith("plan.json"));
    if (!allPlan) {
      // Non-plan.json conflicts — fall through to Claude session.
      return { status: "needs_claude" };
    }

    // Resolve plan.json by accepting theirs (remote/base version).
    try {
      for (const f of currentFiles) {
        execSync(`git checkout --theirs -- ${shellEscape(f)}`, { cwd, stdio: "pipe" });
        execSync(`git add -- ${shellEscape(f)}`, { cwd, stdio: "pipe" });
      }
    } catch (err) {
      const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
      return { status: "failure", error: `plan.json auto-resolve stage failed: ${msg}` };
    }

    // Complete or continue the operation.
    if (operation === "merge") {
      try {
        execSync("git commit --no-edit", { cwd, stdio: "pipe" });
        return { status: "success", commit: head(cwd) };
      } catch (err) {
        const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
        return { status: "failure", error: `plan.json auto-resolve merge commit failed: ${msg}` };
      }
    }

    // Rebase: --continue may succeed (done) or hit another conflict (loop).
    try {
      execSync("git rebase --continue", { cwd, stdio: "pipe", env: { ...process.env, GIT_EDITOR: "true" } });
      // Rebase finished cleanly.
      return { status: "success", commit: head(cwd) };
    } catch (err) {
      // rebase --continue failed — check if it's another conflict (loop) or a real error.
      if (hasConflicts(cwd)) {
        // Another step has conflicts — loop back and check if they're plan.json-only.
        continue;
      }
      const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
      return { status: "failure", error: `plan.json auto-resolve rebase --continue failed: ${msg}` };
    }
  }

  return { status: "failure", error: "plan.json auto-resolve: exceeded maximum rebase steps" };
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

  // Fast-path: when the only conflicted file(s) are plan.json paths, take
  // theirs (remote/base's version). The mergeWorktreeBranch reconcile step
  // re-applies this task's fields afterward, so remote's view of other tasks
  // always wins — no Claude call needed.
  //
  // For rebases with many commits, plan.json may conflict on multiple steps.
  // We loop, auto-resolving each plan.json-only step. If a step introduces
  // non-plan.json conflicts, we break out and fall through to the full
  // Claude resolve-conflicts session.
  const allPlanJson = files.every((f) => f.endsWith("plan.json"));
  if (allPlanJson) {
    const resolved = await autoResolvePlanJsonConflicts(cwd, operation, opts.sessionLabel);
    if (resolved.status === "success") return resolved;
    if (resolved.status === "failure") return resolved;
    // "needs_claude" → fall through to the full resolve-conflicts session below.
  }

  // Re-detect conflicted files — the auto-resolve loop may have advanced
  // through several rebase steps before hitting a non-plan.json conflict.
  const currentFiles = conflictedFiles(cwd);
  if (currentFiles.length === 0) {
    return { status: "failure", error: "No conflicts detected after plan.json auto-resolve" };
  }

  const currentOp = detectOperation(cwd) ?? operation;

  // Gather ref info for context
  let baseRef = "";
  let incomingRef = "";
  try {
    if (currentOp === "merge") {
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
    conflicted_files: currentFiles,
    operation: currentOp,
    base_ref: baseRef,
    incoming_ref: incomingRef,
  };

  const output = await spawnClaudeResolve(cwd, payload, opts.sessionLabel ?? "resolve-conflicts");

  if (output.status !== "resolved") {
    return { status: "failure", error: output.error || "Conflict resolution failed" };
  }

  // Complete the operation. For rebases, --continue may hit further conflicts
  // on subsequent commits. Loop: auto-resolve plan.json-only steps, delegate
  // non-plan.json conflicts back to Claude, until the rebase finishes.
  if (currentOp === "merge") {
    try {
      execSync("git commit --no-edit", { cwd, stdio: "pipe" });
      return { status: "success", commit: head(cwd) };
    } catch (err) {
      return { status: "failure", error: `Failed to complete merge: ${(err as Error).message}` };
    }
  }

  // Rebase: --continue may surface more conflicts on subsequent commits.
  try {
    execSync("git rebase --continue", { cwd, stdio: "pipe", env: { ...process.env, GIT_EDITOR: "true" } });
    return { status: "success", commit: head(cwd) };
  } catch {
    // Another conflict on the next rebase step — recurse to handle it.
    if (hasConflicts(cwd)) {
      return resolveConflicts(opts);
    }
    return { status: "failure", error: "rebase --continue failed after conflict resolution" };
  }
}
