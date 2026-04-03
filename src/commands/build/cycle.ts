import { execSync } from 'node:child_process';
import type { HookMap, TaskContext, DevValidateResult, PlanData } from '../../types.js';
import type { HookContextManager } from '../../lib/hook-context.js';
import { MAX_DEV_VALIDATE_CYCLES } from '../../lib/config.js';
import { log, isSubTaskId, parentTaskId } from '../../lib/utils.js';
import { readPlan, findTask } from './plan-data.js';
import { tryHook } from '../lib/hooks.js';
import { writeReport } from './reports.js';
import { runDevSession, runValidationSession, runCommitSession } from './sessions.js';
import { worktreeBranch } from './worktree.js';

/**
 * Build a task context object from plan data for passing to hooks.
 */
export function buildTaskContext(data: PlanData, taskId: string): TaskContext {
  const isSub = isSubTaskId(taskId);
  const task = isSub ? findTask(data, parentTaskId(taskId)) : findTask(data, taskId);
  if (!task) return {};

  const ctx: TaskContext = {};
  if (task.feature) ctx.feature_id = task.feature;
  if (task.use_case) ctx.usecase_id = task.use_case;
  if (task.scenario) ctx.scenario_id = task.scenario;
  return ctx;
}

/**
 * Core dev-validate loop. Runs dev session then validation session,
 * retrying up to MAX_DEV_VALIDATE_CYCLES times.
 *
 * Hard-stop commit: when validation returns hardStop, stage all files and commit
 * with error details before returning failure.
 */
export async function runDevValidateCycle(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  taskId: string,
  wtPath: string,
  priorSummaries: string[],
  planDir: string | null,
  planTimestamp: string,
  ctxManager?: HookContextManager,
): Promise<DevValidateResult> {
  let issues: string[] = [];

  const data = readPlan(planFile);
  const taskContext = buildTaskContext(data, taskId);

  const isSub = isSubTaskId(taskId);
  const pId = isSub ? parentTaskId(taskId) : taskId;
  const task = findTask(data, pId);
  const baseBranch = data.base_branch || 'main';
  const workingBranch = task ? worktreeBranch(baseBranch, planTimestamp, pId) : '';

  for (let cycle = 1; cycle <= MAX_DEV_VALIDATE_CYCLES; cycle++) {
    log(`Dev-validate cycle ${cycle}/${MAX_DEV_VALIDATE_CYCLES} for ${taskId}`);

    const dev = await runDevSession(projectRoot, planFile, taskId, wtPath, priorSummaries, issues);
    if (!dev.ok) {
      return { ok: false, devResult: dev.structured, validateResult: null, error: dev.structured?.error || 'Dev session failed' };
    }

    const filesModified = dev.structured.files_modified || [];

    // Lifecycle hook: before-commit
    await tryHook(hooks, 'before-commit', {
      task_id: taskId,
      files: filesModified,
      base_branch: baseBranch,
      working_branch: workingBranch,
      ...taskContext,
    }, { ctxManager });

    const val = await runValidationSession(hooks, projectRoot, planFile, taskId, wtPath, {
      filesModified,
      taskContext,
      ctxManager,
    });

    if (planDir) {
      writeReport(planDir, `${taskId}-validate-${cycle}`, val.structured);
    }

    if (!val.ok) {
      if (val.hardStop) {
        log(`Cycle ${cycle}: BDD setup error — stopping task (infrastructure is broken)`);

        // Hard-stop commit: save progress before returning failure
        hardStopCommit(wtPath, taskId, val.issues);

        return {
          ok: false,
          devResult: dev.structured,
          validateResult: val.structured,
          error: `Setup error: ${val.issues.join('; ').slice(0, 500)}`,
        };
      }

      issues = val.issues;
      log(`Cycle ${cycle} failed with ${issues.length} issues — ${cycle < MAX_DEV_VALIDATE_CYCLES ? 'retrying' : 'exhausted'}`);
      continue;
    }

    // Validation passed — commit session
    const commit = await runCommitSession(
      projectRoot, planFile, taskId, wtPath,
      dev.structured.summary, filesModified,
    );

    if (commit.ok) {
      // Lifecycle hook: after-commit
      await tryHook(hooks, 'after-commit', {
        task_id: taskId,
        commits: commit.structured.commits || [],
        files: filesModified,
        base_branch: baseBranch,
        working_branch: workingBranch,
        ...taskContext,
      }, { ctxManager });

      return {
        ok: true,
        devResult: { ...dev.structured, commits: commit.structured.commits } as never,
        validateResult: val.structured,
      };
    }

    issues = [`Commit hook failure:\n${commit.structured.error}`];
    log(`Commit hook failure for ${taskId} — ${cycle < MAX_DEV_VALIDATE_CYCLES ? 'retrying' : 'exhausted'}`);
  }

  return {
    ok: false,
    devResult: null,
    validateResult: null,
    error: `Dev-validate cycle exhausted after ${MAX_DEV_VALIDATE_CYCLES} attempts. Last issues: ${issues.slice(0, 5).join('; ')}`,
  };
}

/**
 * Hard-stop commit: stage all files and commit with error details
 * to preserve progress when infrastructure is broken.
 */
function hardStopCommit(wtPath: string, taskId: string, issues: string[]): void {
  try {
    execSync('git add -A', { cwd: wtPath, stdio: 'pipe' });

    // Check if there's anything to commit
    try {
      execSync('git diff --cached --quiet', { cwd: wtPath, stdio: 'pipe' });
      return; // nothing staged
    } catch {
      // staged changes exist
    }

    const reason = `hard-stop for ${taskId}`;
    const body = issues.slice(0, 10).join('\n');
    const message = `Molcajete: ${reason}\n\n${body}`;
    execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: wtPath, stdio: 'pipe' });
    log(`Hard-stop commit created for ${taskId}`);
  } catch (err) {
    log(`Warning: hard-stop commit failed: ${(err as Error).message}`);
  }
}
