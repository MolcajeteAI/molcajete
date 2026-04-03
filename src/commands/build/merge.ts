import type { HookMap } from '../../types.js';
import type { HookContextManager } from '../../lib/hook-context.js';
import { log, run } from '../../lib/utils.js';
import { readPlan, writePlan, findTask } from './plan-data.js';
import { tryHook } from '../lib/hooks.js';
import { worktreePath, worktreeBranch, cleanupWorktree } from './worktree.js';
import { buildTaskContext, runDevValidateCycle } from './cycle.js';

/**
 * Merge a task's worktree branch back to the base branch.
 */
export async function mergeWorktree(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  baseBranch: string,
  planTimestamp: string,
  taskId: string,
  priorSummaries: string[],
  planDir: string | null,
  ctxManager?: HookContextManager,
): Promise<{ ok: boolean; error?: string }> {
  const wtPath = worktreePath(projectRoot, baseBranch, planTimestamp, taskId);
  const branch = worktreeBranch(baseBranch, planTimestamp, taskId);

  const data = readPlan(planFile);
  const mergeContext = buildTaskContext(data, taskId);

  // Lifecycle hook: before-worktree-merged
  await tryHook(hooks, 'before-worktree-merged', {
    worktree_path: wtPath,
    branch,
    base_branch: baseBranch,
    ...mergeContext,
  }, { ctxManager });

  // Try optional merge hook first
  const hookResult = await tryHook(hooks, 'merge', {
    worktree_path: wtPath,
    branch,
    base_branch: baseBranch,
    ...mergeContext,
  }, { ctxManager });
  if (hookResult) {
    if (hookResult.ok && (hookResult.data as Record<string, unknown>).status === 'ok') {
      const freshData = readPlan(planFile);
      const task = findTask(freshData, taskId);
      if (task) {
        task.status = 'implemented';
        writePlan(planFile, freshData);
        try {
          run(`git add "${planFile}"`, { cwd: projectRoot, stdio: 'pipe' });
          run(`git commit -m "plan: mark ${taskId} implemented"`, { cwd: projectRoot, stdio: 'pipe' });
        } catch {
          log(`Warning: plan commit for ${taskId} failed — plan file may be out of sync`);
        }
      }
      await tryHook(hooks, 'after-worktree-merged', {
        worktree_path: wtPath,
        branch,
        base_branch: baseBranch,
        ...mergeContext,
      }, { ctxManager });
      await cleanupWorktree(hooks, projectRoot, baseBranch, planTimestamp, taskId, mergeContext, { ctxManager });
      log(`Merged and cleaned up (hook): ${taskId}`);
      return { ok: true };
    }
    if (hookResult.ok && (hookResult.data as Record<string, unknown>).status === 'failed') {
      return { ok: false, error: ((hookResult.data as Record<string, unknown>).error as string) || 'merge hook failed' };
    }
    log('merge hook failed, falling back to built-in');
  }

  // Step 1: Rebase onto base branch
  try {
    run(`git -C "${wtPath}" rebase "${baseBranch}"`, { stdio: 'pipe' });
  } catch {
    log(`Rebase conflict for ${taskId} — launching dev session to resolve`);

    try {
      run(`git -C "${wtPath}" rebase --abort`, { stdio: 'pipe' });
    } catch {
      // may already be clean
    }

    const resolution = await runDevValidateCycle(
      hooks, projectRoot, planFile, taskId, wtPath,
      [...priorSummaries, `MERGE CONFLICT: Rebase of ${branch} onto ${baseBranch} failed. Resolve conflicts, stage files, and commit.`],
      planDir,
      planTimestamp,
      ctxManager,
    );

    if (!resolution.ok) {
      return { ok: false, error: `Merge conflict resolution failed: ${resolution.error}` };
    }

    try {
      run(`git -C "${wtPath}" rebase "${baseBranch}"`, { stdio: 'pipe' });
    } catch {
      return { ok: false, error: 'Rebase still failing after conflict resolution' };
    }
  }

  // Step 2: Fast-forward merge
  try {
    run(`git checkout "${baseBranch}"`, { cwd: projectRoot, stdio: 'pipe' });
    run(`git merge --no-edit "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch (err) {
    return { ok: false, error: `Fast-forward merge failed: ${(err as Error).message}` };
  }

  // Step 3: Update plan file and commit
  const freshData = readPlan(planFile);
  const task = findTask(freshData, taskId);
  if (task) {
    task.status = 'implemented';
    writePlan(planFile, freshData);

    try {
      run(`git add "${planFile}"`, { cwd: projectRoot, stdio: 'pipe' });
      run(`git commit -m "plan: mark ${taskId} implemented"`, { cwd: projectRoot, stdio: 'pipe' });
    } catch {
      log(`Warning: plan commit for ${taskId} failed — plan file may be out of sync`);
    }
  }

  // Lifecycle hook: after-worktree-merged
  await tryHook(hooks, 'after-worktree-merged', {
    worktree_path: wtPath,
    branch,
    base_branch: baseBranch,
    ...mergeContext,
  }, { ctxManager });

  // Step 4: Cleanup (always after successful merge)
  await cleanupWorktree(hooks, projectRoot, baseBranch, planTimestamp, taskId, mergeContext, { ctxManager });
  log(`Merged and cleaned up: ${taskId}`);

  return { ok: true };
}
