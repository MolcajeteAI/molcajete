import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HookMap, TaskContext } from '../../types.js';
import type { HookContextManager } from '../../lib/hook-context.js';
import { log, run } from '../../lib/utils.js';
import { tryHook } from '../lib/hooks.js';

// ── Worktree Naming ──

export function worktreePath(projectRoot: string, baseBranch: string, planTimestamp: string, taskId: string): string {
  return join(projectRoot, '.molcajete', 'worktrees', `${baseBranch}--${planTimestamp}--${taskId}`);
}

export function worktreeBranch(baseBranch: string, planTimestamp: string, taskId: string): string {
  return `molcajete/${baseBranch}--${planTimestamp}--${taskId}`;
}

// ── Forward declaration for worktree fix session (injected at runtime) ──

type WorktreeFixFn = (
  projectRoot: string,
  wtPath: string,
  branch: string,
  baseBranch: string,
  errorOutput: string,
) => Promise<{ ok: boolean; path: string; error?: string }>;

let worktreeFixSession: WorktreeFixFn | null = null;

export function setWorktreeFixSession(fn: WorktreeFixFn): void {
  worktreeFixSession = fn;
}

// ── Prepare Worktree ──

export async function prepareWorktree(
  hooks: HookMap,
  projectRoot: string,
  baseBranch: string,
  planTimestamp: string,
  taskId: string,
  taskContext: TaskContext = {},
  { ctxManager }: { ctxManager?: HookContextManager } = {},
): Promise<{ ok: boolean; path: string; error?: string }> {
  const wtPath = worktreePath(projectRoot, baseBranch, planTimestamp, taskId);
  const branch = worktreeBranch(baseBranch, planTimestamp, taskId);

  // Lifecycle hook: before-worktree-created
  await tryHook(hooks, 'before-worktree-created', {
    path: wtPath,
    branch,
    base_branch: baseBranch,
    ...taskContext,
  }, { ctxManager });

  // Try optional create-worktree hook first
  const hookResult = await tryHook(hooks, 'create-worktree', {
    path: wtPath,
    branch,
    base_branch: baseBranch,
    ...taskContext,
  }, { ctxManager });
  if (hookResult) {
    if (hookResult.ok && (hookResult.data as Record<string, unknown>).status === 'ok') {
      const hookPath = ((hookResult.data as Record<string, unknown>).path as string) || wtPath;
      log(`Worktree ready (hook): ${hookPath}`);
      await tryHook(hooks, 'after-worktree-created', {
        path: hookPath,
        branch,
        base_branch: baseBranch,
        ...taskContext,
      }, { ctxManager });
      return { ok: true, path: hookPath };
    }
    if (hookResult.ok && (hookResult.data as Record<string, unknown>).status === 'failed') {
      return { ok: false, path: wtPath, error: ((hookResult.data as Record<string, unknown>).error as string) || 'create-worktree hook failed' };
    }
    log('create-worktree hook failed, falling back to built-in');
  }

  mkdirSync(join(projectRoot, '.molcajete', 'worktrees'), { recursive: true });

  // Check for stale worktree
  try {
    const list = run('git worktree list --porcelain', { cwd: projectRoot });
    if (list.includes(wtPath)) {
      log(`Removing stale worktree: ${wtPath}`);
      run(`git worktree remove --force "${wtPath}"`, { cwd: projectRoot });
    }
  } catch {
    // ignore
  }

  // Clean up stale branch
  try {
    run(`git branch -D "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // branch doesn't exist
  }

  // Create worktree
  try {
    run(
      `git worktree add -b "${branch}" "${wtPath}" "${baseBranch}"`,
      { cwd: projectRoot, stdio: 'pipe' },
    );
    log(`Worktree ready: ${wtPath}`);
    await tryHook(hooks, 'after-worktree-created', {
      path: wtPath,
      branch,
      base_branch: baseBranch,
      ...taskContext,
    }, { ctxManager });
    return { ok: true, path: wtPath };
  } catch (err) {
    log('Worktree creation failed — launching fix session');
    if (worktreeFixSession) {
      return await worktreeFixSession(projectRoot, wtPath, branch, baseBranch, (err as Error).message);
    }
    return { ok: false, path: wtPath, error: (err as Error).message };
  }
}

// ── Cleanup Worktree ──

export async function cleanupWorktree(
  hooks: HookMap,
  projectRoot: string,
  baseBranch: string,
  planTimestamp: string,
  taskId: string,
  taskContext: TaskContext = {},
  { ctxManager }: { ctxManager?: HookContextManager } = {},
): Promise<void> {
  const wtPath = worktreePath(projectRoot, baseBranch, planTimestamp, taskId);
  const branch = worktreeBranch(baseBranch, planTimestamp, taskId);

  // Try optional cleanup hook first
  const hookResult = await tryHook(hooks, 'cleanup', { path: wtPath, branch, ...taskContext }, { ctxManager });
  if (hookResult?.ok && (hookResult.data as Record<string, unknown>).status === 'ok') {
    return;
  }

  // Built-in cleanup
  try {
    run(`git worktree remove --force "${wtPath}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // already removed
  }
  try {
    run(`git branch -d "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    try {
      run(`git branch -D "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
    } catch {
      // truly gone
    }
  }
}

// ── Push Worktree Branch ──

export function pushWorktreeBranch(wtPath: string, branch: string): void {
  try {
    run(`git push origin "${branch}"`, { cwd: wtPath, stdio: 'pipe' });
    log(`Pushed branch: ${branch}`);
  } catch (err) {
    log(`Warning: push failed for ${branch}: ${(err as Error).message}`);
  }
}
