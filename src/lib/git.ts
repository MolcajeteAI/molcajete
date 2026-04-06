import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESOLVE_CONFLICTS_SCHEMA } from './config.js';
import { log } from './utils.js';
import type { ResolveConflictsOutput } from '../types.js';

export interface GitResult {
  status: 'success' | 'failure';
  commit?: string;
  error?: string;
}

export interface MergeOptions {
  ffOnly?: boolean;
}

// ── Helpers ──

function head(): string {
  return execSync('git rev-parse HEAD', { stdio: 'pipe' }).toString().trim();
}

function hasConflicts(): boolean {
  const status = execSync('git status --porcelain', { stdio: 'pipe' }).toString();
  return /^(UU|AA|DD|AU|UA|DU|UD) /m.test(status);
}

function conflictedFiles(): string[] {
  const status = execSync('git status --porcelain', { stdio: 'pipe' }).toString();
  const files: string[] = [];
  for (const line of status.split('\n')) {
    if (/^(UU|AA|DD|AU|UA|DU|UD) /.test(line)) {
      files.push(line.slice(3));
    }
  }
  return files;
}

function detectOperation(cwd: string): 'merge' | 'rebase' | null {
  const gitDir = execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' }).toString().trim();
  if (existsSync(resolve(cwd, gitDir, 'MERGE_HEAD'))) return 'merge';
  if (existsSync(resolve(cwd, gitDir, 'rebase-merge')) || existsSync(resolve(cwd, gitDir, 'rebase-apply'))) return 'rebase';
  return null;
}

async function spawnClaudeResolve(cwd: string, payload: Record<string, unknown>): Promise<ResolveConflictsOutput> {
  // Lazy import to avoid circular dependency with CLI-only code
  const { invokeClaude, extractStructuredOutput } = await import('../commands/lib/claude.js');

  const result = await invokeClaude(cwd, [
    '--model', 'sonnet',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
    '--max-turns', '30',
    '--json-schema', JSON.stringify(RESOLVE_CONFLICTS_SCHEMA),
    '--name', 'resolve-conflicts',
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
  hasConflicts?: boolean;
  error?: string;
}

/**
 * Create a git worktree with a new branch.
 * If the branch already exists (prior failed run), reuses it.
 */
export function createWorktree(
  projectRoot: string,
  branchName: string,
  worktreePath: string,
  baseBranch: string,
): WorktreeResult {
  try {
    execSync(
      `git worktree add -b ${branchName} ${worktreePath} ${baseBranch}`,
      { cwd: projectRoot, stdio: 'pipe' },
    );
    return { ok: true };
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();

    // Branch already exists — reuse it
    if (/already exists/i.test(msg)) {
      try {
        execSync(
          `git worktree add ${worktreePath} ${branchName}`,
          { cwd: projectRoot, stdio: 'pipe' },
        );
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
 * Remove a git worktree and delete its branch (safe delete).
 * Non-fatal: logs warnings on failure.
 */
export function removeWorktree(
  projectRoot: string,
  worktreePath: string,
  branchName: string,
): void {
  try {
    execSync(`git worktree remove ${worktreePath} --force`, {
      cwd: projectRoot,
      stdio: 'pipe',
    });
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    log(`Warning: failed to remove worktree ${worktreePath}: ${msg}`);
  }

  try {
    execSync(`git branch -d ${branchName}`, {
      cwd: projectRoot,
      stdio: 'pipe',
    });
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    log(`Warning: failed to delete local branch ${branchName}: ${msg}`);
  }

  // Delete the remote branch if it exists
  try {
    execSync(`git push origin --delete ${branchName}`, {
      cwd: projectRoot,
      stdio: 'pipe',
    });
  } catch {
    // Remote branch may not exist (push was never enabled) — ignore silently
  }
}

/**
 * Merge a worktree branch back into the base branch with --no-ff.
 * Does NOT auto-resolve conflicts — returns conflict status for caller to orchestrate.
 */
export function mergeWorktreeBranch(
  projectRoot: string,
  branchName: string,
  baseBranch: string,
): MergeWorktreeResult {
  try {
    execSync(`git checkout ${baseBranch}`, { cwd: projectRoot, stdio: 'pipe' });
  } catch (err) {
    return { ok: false, error: `Failed to checkout ${baseBranch}: ${(err as Error).message}` };
  }

  try {
    execSync(`git merge --no-ff ${branchName}`, { cwd: projectRoot, stdio: 'pipe' });
    return { ok: true };
  } catch {
    // Check if it's a conflict or a hard failure
    try {
      const status = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' }).toString();
      if (/^(UU|AA|DD|AU|UA|DU|UD) /m.test(status)) {
        return { ok: false, hasConflicts: true };
      }
    } catch { /* fall through */ }

    return { ok: false, error: 'Merge failed (no conflicts detected)' };
  }
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
  const execOpts = { stdio: 'pipe' as const, ...(cwd && { cwd }) };

  // Resolve current branch
  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).toString().trim();
  } catch (err) {
    return { ok: false, skipped: true, error: `could not resolve HEAD: ${(err as Error).message}` };
  }

  if (branch === 'HEAD') {
    return { ok: false, skipped: true, error: 'detached HEAD' };
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

// ── Public API ──

export async function merge(base: string, branch: string, options?: MergeOptions): Promise<GitResult> {
  const ffOnly = options?.ffOnly ?? true;
  const cwd = process.cwd();

  try {
    if (ffOnly) {
      try {
        execSync(`git merge --ff-only ${branch}`, { cwd, stdio: 'pipe' });
        return { status: 'success', commit: head() };
      } catch {
        return { status: 'failure', error: 'Not fast-forwardable — rebase first' };
      }
    }

    // Non-ff merge
    try {
      execSync(`git merge ${branch}`, { cwd, stdio: 'pipe' });
      return { status: 'success', commit: head() };
    } catch {
      if (!hasConflicts()) {
        return { status: 'failure', error: 'Merge failed (no conflicts detected)' };
      }

      const result = await resolveConflicts();

      if (result.status === 'failure') {
        try { execSync('git merge --abort', { cwd, stdio: 'pipe' }); } catch { /* already clean */ }
        return result;
      }

      return result;
    }
  } catch (err) {
    return { status: 'failure', error: (err as Error).message };
  }
}

export async function rebase(onto: string, branch: string): Promise<GitResult> {
  const cwd = process.cwd();

  try {
    execSync(`git checkout ${branch}`, { cwd, stdio: 'pipe' });
  } catch (err) {
    return { status: 'failure', error: `Failed to checkout ${branch}: ${(err as Error).message}` };
  }

  try {
    execSync(`git rebase ${onto}`, { cwd, stdio: 'pipe' });
    return { status: 'success', commit: head() };
  } catch {
    if (!hasConflicts()) {
      try { execSync('git rebase --abort', { cwd, stdio: 'pipe' }); } catch { /* already clean */ }
      return { status: 'failure', error: 'Rebase failed (no conflicts detected)' };
    }

    const result = await resolveConflicts();

    if (result.status === 'failure') {
      try { execSync('git rebase --abort', { cwd, stdio: 'pipe' }); } catch { /* already clean */ }
      return result;
    }

    return result;
  }
}

export async function resolveConflicts(): Promise<GitResult> {
  const cwd = process.cwd();
  const files = conflictedFiles();

  if (files.length === 0) {
    return { status: 'failure', error: 'No conflicts detected' };
  }

  const operation = detectOperation(cwd);
  if (!operation) {
    return { status: 'failure', error: 'No merge or rebase in progress' };
  }

  // Gather ref info for context
  let baseRef = '';
  let incomingRef = '';
  try {
    if (operation === 'merge') {
      baseRef = execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim();
      incomingRef = execSync('git rev-parse MERGE_HEAD', { cwd, stdio: 'pipe' }).toString().trim();
    } else {
      const gitDir = execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' }).toString().trim();
      baseRef = execSync(`cat ${gitDir}/rebase-merge/onto`, { cwd, stdio: 'pipe' }).toString().trim();
      incomingRef = execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim();
    }
  } catch { /* non-fatal — Claude can still resolve without refs */ }

  const payload = {
    conflicted_files: files,
    operation,
    base_ref: baseRef,
    incoming_ref: incomingRef,
  };

  const output = await spawnClaudeResolve(cwd, payload);

  if (output.status !== 'resolved') {
    return { status: 'failure', error: output.error || 'Conflict resolution failed' };
  }

  // Complete the operation
  try {
    if (operation === 'merge') {
      execSync('git commit --no-edit', { cwd, stdio: 'pipe' });
    } else {
      execSync('git rebase --continue', { cwd, stdio: 'pipe', env: { ...process.env, GIT_EDITOR: 'true' } });
    }
    return { status: 'success', commit: head() };
  } catch (err) {
    return { status: 'failure', error: `Failed to complete ${operation}: ${(err as Error).message}` };
  }
}
