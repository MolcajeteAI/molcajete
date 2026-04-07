import { resolve } from "node:path";
import { execSync } from "node:child_process";
import type { HookMap, Settings, WorktreeInfo } from "../../types.js";
import { MAX_MERGE_FIX_CYCLES } from "../../lib/config.js";
import { log } from "../../lib/utils.js";
import { createWorktree, removeWorktree, mergeWorktreeBranch, resolveConflicts } from "../../lib/git.js";
import { tryHook } from "../lib/hooks.js";
import { readPlan } from "./plan-data.js";
import { buildBuildContext } from "./cycle.js";
import { runDevSession, runVerifyHook, runReviewSession, maybePushAfterCommit } from "./sessions.js";

/**
 * Set up a git worktree for a task.
 * Branch name: <planName>--<taskId>
 * Worktree path: <projectRoot>/.worktrees/<branchName>
 * Fires before/after-worktree-create hooks.
 */
export async function setupWorktree(
  hooks: HookMap,
  projectRoot: string,
  planName: string,
  taskId: string,
  baseBranch: string,
  planFile: string,
  settings: Settings,
): Promise<WorktreeInfo | null> {
  const branchName = `${planName}--${taskId}`;
  const worktreePath = resolve(projectRoot, ".worktrees", branchName);

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

  log(`Creating worktree: ${branchName}`);
  const result = createWorktree(projectRoot, branchName, worktreePath, baseBranch);

  if (!result.ok) {
    log(`Failed to create worktree: ${result.error}`);
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

  log(`Merging worktree branch ${branchName} into ${baseBranch}`);
  const mergeResult = mergeWorktreeBranch(projectRoot, branchName, baseBranch);

  if (mergeResult.ok) {
    // Clean merge — remove worktree and branch
    removeWorktree(projectRoot, worktreePath, branchName);

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

  if (mergeResult.hasConflicts) {
    log(`Merge conflicts detected for ${branchName} — entering conflict resolution`);

    const sideLoopResult = await runMergeConflictSideLoop(hooks, projectRoot, planFile, taskId, settings, planName);

    if (sideLoopResult.ok) {
      removeWorktree(projectRoot, worktreePath, branchName);

      await tryHook(hooks, "after-worktree-merge", {
        task_id: taskId,
        branch: branchName,
        base_branch: baseBranch,
        worktree_path: worktreePath,
        build: buildBuildContext(planFile, planName, "after-worktree-merge"),
      });

      return { ok: true };
    }

    // Side-loop failed — preserve worktree for debugging
    log(`Merge conflict resolution failed — worktree preserved at ${worktreePath}`);

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

    return { ok: false, error: sideLoopResult.error || "Merge conflict resolution failed" };
  }

  // Merge failed without conflicts — abort
  log(`Merge failed (no conflicts): ${mergeResult.error}`);
  try {
    execSync("git merge --abort", { cwd: projectRoot, stdio: "pipe" });
  } catch {
    /* already clean */
  }

  await tryHook(hooks, "after-worktree-merge", {
    task_id: taskId,
    branch: branchName,
    base_branch: baseBranch,
    worktree_path: worktreePath,
    build: buildBuildContext(planFile, planName, "after-worktree-merge"),
  });

  return { ok: false, error: mergeResult.error || "Merge failed" };
}

/**
 * Merge conflict side-loop: resolve conflicts, verify, review, fix.
 * Loops up to MAX_MERGE_FIX_CYCLES times.
 *
 * After conflict resolution we're on the base branch — all dev/verify/review
 * runs in projectRoot, not the worktree.
 */
async function runMergeConflictSideLoop(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  taskId: string,
  settings: Settings,
  planName: string,
): Promise<{ ok: boolean; error?: string }> {
  // Collect scenario tags from implemented tasks + current task for regression scope
  const data = readPlan(planFile);
  const regressionTags: string[] = [];
  for (const t of data.tasks) {
    if ((t.status === "implemented" || t.id === taskId) && t.scenario) {
      regressionTags.push(`@${t.scenario}`);
    }
  }

  for (let cycle = 1; cycle <= MAX_MERGE_FIX_CYCLES; cycle++) {
    log(`Merge conflict fix cycle ${cycle}/${MAX_MERGE_FIX_CYCLES}`);

    // 1. Resolve conflicts (Claude resolves + commits)
    const resolveResult = await resolveConflicts();
    if (resolveResult.status === "failure") {
      log(`Conflict resolution failed: ${resolveResult.error}`);
      try {
        execSync("git merge --abort", { cwd: projectRoot, stdio: "pipe" });
      } catch {
        /* already clean */
      }
      return { ok: false, error: resolveResult.error || "Conflict resolution failed" };
    }

    // 2. Verify with plan-scoped regression (scope: 'final', on base branch)
    const verify = await runVerifyHook(hooks, {
      taskId,
      planFile,
      filesModified: [],
      scope: "final",
      settings,
      planName,
      stage: "validation",
    });

    if (verify.ok) {
      // 3. Review session
      const review = await runReviewSession(hooks, planFile, taskId, settings, planName);

      if (review.ok) {
        return { ok: true };
      }

      // Review failed — dev session to fix
      if (cycle < MAX_MERGE_FIX_CYCLES) {
        log(`Post-merge review found ${review.issues.length} issues — fixing`);
        await runDevSession(projectRoot, planFile, taskId, [], review.issues);
        maybePushAfterCommit(settings, `merge-fix ${taskId}`);
        continue;
      }

      return { ok: false, error: `Post-merge review failed after ${MAX_MERGE_FIX_CYCLES} cycles` };
    }

    // Verify failed — dev session to fix, then loop back
    if (cycle < MAX_MERGE_FIX_CYCLES) {
      log(`Post-merge verify failed with ${verify.issues.length} issues — fixing`);
      await runDevSession(projectRoot, planFile, taskId, [], verify.issues);
      maybePushAfterCommit(settings, `merge-fix ${taskId}`);
      continue;
    }

    return { ok: false, error: `Post-merge verify failed after ${MAX_MERGE_FIX_CYCLES} cycles` };
  }

  return { ok: false, error: "Merge conflict side-loop exhausted" };
}
