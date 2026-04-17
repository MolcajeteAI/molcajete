import { resolve } from "node:path";
import type { AsyncMutex } from "../../lib/async-mutex.js";
import { createWorktree, fetchBase, mergeWorktreeBranch, removeWorktree } from "../../lib/git.js";
import { log, logDetail } from "../../lib/utils.js";
import type { HookMap, Settings, WorktreeInfo } from "../../types.js";
import { tryHook } from "../lib/hooks.js";
import { buildBuildContext } from "./cycle.js";

/**
 * Set up a git worktree for a task.
 * Branch name: <planName>--<taskId>
 * Worktree path: <projectRoot>/.molcajete/worktrees/<branchName>
 * Fires before/after-worktree-create hooks.
 *
 * When `resume` is true and the worktree is missing, the branch is
 * recovered from the remote rather than recreated from base_branch.
 */
export async function setupWorktree(
  hooks: HookMap,
  projectRoot: string,
  planName: string,
  taskId: string,
  baseBranch: string,
  planFile: string,
  settings: Settings,
  resume: boolean,
  gitMutex?: AsyncMutex,
): Promise<WorktreeInfo | null> {
  const branchName = `${planName}--${taskId}`;
  const worktreePath = resolve(projectRoot, ".molcajete", "worktrees", branchName);

  await tryHook(
    hooks,
    "before-worktree-create",
    {
      task_id: taskId,
      branch: branchName,
      base_branch: baseBranch,
      worktree_path: worktreePath,
      build: buildBuildContext(planFile, planName, "before-worktree-create"),
    },
    { timeout: settings.hookTimeout },
  );

  // Fetch + create hold projectRoot's .git/index.lock; serialize under gitMutex
  // so concurrent workers don't trample each other.
  const createGitOps = async () => {
    if (!resume) {
      const fetched = fetchBase(projectRoot, settings.remote, baseBranch);
      if (!fetched.ok) {
        return { ok: false as const, error: `fetch ${settings.remote}/${baseBranch}: ${fetched.error}` };
      }
    }

    logDetail(`Creating worktree: ${branchName}`);
    const result = createWorktree(projectRoot, branchName, worktreePath, baseBranch, {
      resume,
      remote: settings.remote,
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error ?? "createWorktree failed" };
    }
    return { ok: true as const };
  };

  const outcome = gitMutex ? await gitMutex.run(createGitOps) : await createGitOps();
  if (!outcome.ok) {
    log(`Failed to create worktree: ${outcome.error}`);
    return null;
  }

  await tryHook(
    hooks,
    "after-worktree-create",
    {
      task_id: taskId,
      branch: branchName,
      base_branch: baseBranch,
      worktree_path: worktreePath,
      build: buildBuildContext(planFile, planName, "after-worktree-create"),
    },
    { timeout: settings.hookTimeout },
  );

  return { branchName, worktreePath, baseBranch };
}

/**
 * Merge a worktree branch back into the base branch.
 * Fires before/after-worktree-merge hooks.
 * On conflicts, runs the merge conflict side-loop.
 */
export async function mergeWorktree(
  hooks: HookMap,
  projectRoot: string,
  worktree: WorktreeInfo,
  planFile: string,
  taskId: string,
  settings: Settings,
  planName: string,
  planRelPath?: string,
  gitMutex?: AsyncMutex,
): Promise<{ ok: boolean; error?: string }> {
  const { branchName, worktreePath, baseBranch } = worktree;

  // Fire before-worktree-merge hook
  await tryHook(
    hooks,
    "before-worktree-merge",
    {
      task_id: taskId,
      branch: branchName,
      base_branch: baseBranch,
      worktree_path: worktreePath,
      build: buildBuildContext(planFile, planName, "before-worktree-merge"),
    },
    { timeout: settings.hookTimeout },
  );

  log(`Merging worktree branch ${branchName} into ${settings.remote}/${baseBranch}`);
  const mergeResult = await mergeWorktreeBranch(projectRoot, branchName, baseBranch, worktreePath, settings.remote, {
    taskId,
    planRelPath,
  });

  if (mergeResult.ok) {
    // Clean merge — remove worktree and branch
    if (gitMutex) {
      await gitMutex.run(() => removeWorktree(projectRoot, worktreePath, branchName));
    } else {
      removeWorktree(projectRoot, worktreePath, branchName);
    }

    await tryHook(
      hooks,
      "after-worktree-merge",
      {
        task_id: taskId,
        branch: branchName,
        base_branch: baseBranch,
        worktree_path: worktreePath,
        build: buildBuildContext(planFile, planName, "after-worktree-merge"),
      },
      { timeout: settings.hookTimeout },
    );

    return { ok: true };
  }

  // Merge failed after the rebase + ff-only promotion attempt. Either the rebase
  // could not be resolved (Claude bailed, or conflicts were truly contradictory)
  // or the final ff-only step tripped. Preserve the worktree for inspection.
  log(`Merge failed — worktree preserved at ${worktreePath}`);
  log(`Reason: ${mergeResult.error}`);

  await tryHook(
    hooks,
    "after-worktree-merge",
    {
      task_id: taskId,
      branch: branchName,
      base_branch: baseBranch,
      worktree_path: worktreePath,
      build: buildBuildContext(planFile, planName, "after-worktree-merge"),
    },
    { timeout: settings.hookTimeout },
  );

  return { ok: false, error: mergeResult.error || "Merge failed" };
}
