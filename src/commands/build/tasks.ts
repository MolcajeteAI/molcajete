import type { HookMap, Task, Settings } from '../../types.js';
import type { HookContextManager } from '../../lib/hook-context.js';
import { MAX_DEV_VALIDATE_CYCLES } from '../../lib/config.js';
import { log, isSubTaskId } from '../../lib/utils.js';
import { readPlan, findTask, updateSubTaskStatus, checkSubTaskDeps } from './plan-data.js';
import { tryHook } from '../lib/hooks.js';
import { writeReport } from './reports.js';
import { buildTaskContext, runDevValidateCycle } from './cycle.js';
import { runDevSession, runValidationSession, runCommitSession, runDocSession, commitDocChanges } from './sessions.js';
import { mergeWorktree } from './merge.js';
import { pushWorktreeBranch, worktreeBranch } from './worktree.js';

/**
 * Run a simple task (no sub-tasks): dev-validate cycle then merge.
 */
export async function runSimpleTask(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  task: Task,
  baseBranch: string,
  planTimestamp: string,
  priorSummaries: string[],
  planDir: string | null,
  wtPath: string,
  settings: Settings,
  ctxManager?: HookContextManager,
): Promise<{ ok: boolean; error?: string; devResult?: unknown }> {
  const taskId = task.id;

  const data = readPlan(planFile);
  const taskContext = buildTaskContext(data, taskId);

  // Lifecycle hook: before-task
  await tryHook(hooks, 'before-task', {
    task_id: taskId, intent: task.intent, ...taskContext,
  }, { ctxManager });

  const result = await runDevValidateCycle(hooks, projectRoot, planFile, taskId, wtPath, priorSummaries, planDir, planTimestamp, ctxManager);

  if (!result.ok) {
    await tryHook(hooks, 'after-task', {
      task_id: taskId, status: 'failed', summary: result.error || '', ...taskContext,
    }, { ctxManager });
    return { ok: false, error: result.error, devResult: result.devResult };
  }

  // Push branch if persistWorktreeBranches is enabled
  if (settings.persistWorktreeBranches && wtPath !== projectRoot) {
    const branch = worktreeBranch(baseBranch, planTimestamp, taskId);
    pushWorktreeBranch(wtPath, branch);
  }

  // Doc session + merge only in worktree mode
  if (wtPath !== projectRoot) {
    const filesModified = result.devResult?.files_modified || [];
    const devSummary = result.devResult?.summary || '';
    const doc = await runDocSession(projectRoot, planFile, task, wtPath, devSummary, filesModified);
    if (doc.ok && doc.structured?.files_modified?.length > 0) {
      const docCommit = await commitDocChanges(wtPath, taskId, doc.structured.files_modified);
      if (!docCommit.ok) {
        log(`Warning: doc commit failed for ${taskId} — proceeding to merge`);
      }
    } else if (!doc.ok) {
      log(`Warning: doc session failed for ${taskId} — proceeding to merge`);
    }

    const merge = await mergeWorktree(hooks, projectRoot, planFile, baseBranch, planTimestamp, taskId, priorSummaries, planDir, ctxManager);
    if (!merge.ok) {
      await tryHook(hooks, 'after-task', {
        task_id: taskId, status: 'failed', summary: merge.error || '', ...taskContext,
      }, { ctxManager });
      return { ok: false, error: merge.error, devResult: result.devResult };
    }
  }

  await tryHook(hooks, 'after-task', {
    task_id: taskId, status: 'implemented', summary: result.devResult?.summary || '', ...taskContext,
  }, { ctxManager });

  return { ok: true, devResult: result.devResult };
}

/**
 * Run a task with sub-tasks: iterate sub-tasks, then task-level validation.
 */
export async function runTaskWithSubTasks(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  task: Task,
  baseBranch: string,
  planTimestamp: string,
  priorSummaries: string[],
  planDir: string | null,
  wtPath: string,
  settings: Settings,
  ctxManager?: HookContextManager,
): Promise<{ ok: boolean; error?: string }> {
  const taskId = task.id;
  const subTasks = task.sub_tasks!;
  const subSummaries = [...priorSummaries];
  const allFilesModified: string[] = [];

  const data = readPlan(planFile);
  const taskContext = buildTaskContext(data, taskId);

  // Lifecycle hook: before-task
  await tryHook(hooks, 'before-task', {
    task_id: taskId, intent: task.intent, ...taskContext,
  }, { ctxManager });

  // Run each sub-task sequentially
  for (const st of subTasks) {
    const stId = st.id;

    const freshData = readPlan(planFile);
    const freshTask = findTask(freshData, taskId);
    if (!freshTask) continue;
    const depResult = checkSubTaskDeps(freshTask, stId);

    if (depResult === 1) {
      log(`Sub-task ${stId}: dependency failed — skipping`);
      updateSubTaskStatus(planFile, stId, 'failed', { error: 'Dependency failed' });
      return { ok: false, error: `Sub-task ${stId} dependency failed` };
    }

    if (depResult === 2) {
      log(`Sub-task ${stId}: dependency not yet done — skipping`);
      continue;
    }

    if (st.status === 'implemented') {
      if (st.summary) subSummaries.push(st.summary);
      continue;
    }

    log(`── Sub-task: ${stId} — ${st.title} ──`);

    // Subtask scope lifecycle
    ctxManager?.newSubtaskScope();

    await tryHook(hooks, 'before-subtask', {
      task_id: taskId, subtask_id: stId, ...taskContext,
      ...(ctxManager ? { snapshot: ctxManager.snapshot(taskId, stId) } : {}),
    }, { ctxManager });

    updateSubTaskStatus(planFile, stId, 'in_progress');

    const result = await runDevValidateCycle(hooks, projectRoot, planFile, stId, wtPath, subSummaries, planDir, planTimestamp, ctxManager);

    if (!result.ok) {
      updateSubTaskStatus(planFile, stId, 'failed', { errors: [result.error] });

      await tryHook(hooks, 'after-subtask', {
        task_id: taskId, subtask_id: stId, status: 'failed', ...taskContext,
        ...(ctxManager ? { snapshot: ctxManager.snapshot(taskId, stId) } : {}),
      }, { ctxManager });
      ctxManager?.clearSubtaskScope();

      return { ok: false, error: `Sub-task ${stId} failed: ${result.error}` };
    }

    updateSubTaskStatus(planFile, stId, 'implemented', {
      summary: result.devResult?.summary || null,
    });

    if (result.devResult?.files_modified) allFilesModified.push(...result.devResult.files_modified);
    if (result.devResult?.summary) subSummaries.push(result.devResult.summary);
    log(`Sub-task ${stId}: implemented`);

    await tryHook(hooks, 'after-subtask', {
      task_id: taskId, subtask_id: stId, status: 'implemented', ...taskContext,
      ...(ctxManager ? { snapshot: ctxManager.snapshot(taskId, stId) } : {}),
    }, { ctxManager });
    ctxManager?.clearSubtaskScope();

    // Push branch after sub-task commit if enabled
    if (settings.persistWorktreeBranches && wtPath !== projectRoot) {
      const branch = worktreeBranch(baseBranch, planTimestamp, taskId);
      pushWorktreeBranch(wtPath, branch);
    }
  }

  // Task-level validation with BDD
  log(`Running task-level validation for ${taskId} (with BDD)`);
  let valCycleCount = 0;
  const taskVal = await runValidationSession(hooks, projectRoot, planFile, taskId, wtPath, { ctxManager });
  valCycleCount++;
  if (planDir) writeReport(planDir, `${taskId}-validate-${valCycleCount}`, taskVal.structured);

  if (!taskVal.ok) {
    if (taskVal.hardStop) {
      log('Task-level validation: BDD setup error — stopping task (infrastructure is broken)');
      return { ok: false, error: `Setup error: ${taskVal.issues.join('; ').slice(0, 500)}` };
    }

    log(`Task-level validation failed for ${taskId} — launching fix cycle`);
    let fixIssues = taskVal.issues;

    for (let cycle = 1; cycle <= MAX_DEV_VALIDATE_CYCLES; cycle++) {
      log(`Task-level fix cycle ${cycle}/${MAX_DEV_VALIDATE_CYCLES} for ${taskId}`);

      const dev = await runDevSession(projectRoot, planFile, taskId, wtPath, subSummaries, fixIssues);
      if (!dev.ok) {
        return { ok: false, error: `Task-level fix failed: ${dev.structured?.error || 'Dev session failed'}` };
      }

      const reVal = await runValidationSession(hooks, projectRoot, planFile, taskId, wtPath, { ctxManager });
      valCycleCount++;
      if (planDir) writeReport(planDir, `${taskId}-validate-${valCycleCount}`, reVal.structured);

      if (!reVal.ok) {
        if (reVal.hardStop) {
          log(`Task-level fix cycle ${cycle}: BDD setup error — stopping task`);
          return { ok: false, error: `Setup error: ${reVal.issues.join('; ').slice(0, 500)}` };
        }

        if (cycle === MAX_DEV_VALIDATE_CYCLES) {
          return { ok: false, error: `Task-level validation exhausted after ${MAX_DEV_VALIDATE_CYCLES} fix cycles` };
        }
        fixIssues = reVal.issues;
        continue;
      }

      const commit = await runCommitSession(
        projectRoot, planFile, taskId, wtPath,
        dev.structured.summary, dev.structured.files_modified,
      );

      if (commit.ok) break;

      if (cycle === MAX_DEV_VALIDATE_CYCLES) {
        return { ok: false, error: `Task-level fix exhausted after ${MAX_DEV_VALIDATE_CYCLES} cycles (last: commit hook failure)` };
      }
      fixIssues = [`Commit hook failure:\n${commit.structured.error}`];
    }
  }

  // Push branch if enabled
  if (settings.persistWorktreeBranches && wtPath !== projectRoot) {
    const branch = worktreeBranch(baseBranch, planTimestamp, taskId);
    pushWorktreeBranch(wtPath, branch);
  }

  // Doc session + merge only in worktree mode
  if (wtPath !== projectRoot) {
    const devSummary = subSummaries.join('\n');
    const doc = await runDocSession(projectRoot, planFile, task, wtPath, devSummary, allFilesModified);
    if (doc.ok && doc.structured?.files_modified?.length > 0) {
      const docCommit = await commitDocChanges(wtPath, taskId, doc.structured.files_modified);
      if (!docCommit.ok) {
        log(`Warning: doc commit failed for ${taskId} — proceeding to merge`);
      }
    } else if (!doc.ok) {
      log(`Warning: doc session failed for ${taskId} — proceeding to merge`);
    }

    const merge = await mergeWorktree(hooks, projectRoot, planFile, baseBranch, planTimestamp, taskId, subSummaries, planDir, ctxManager);
    if (!merge.ok) {
      await tryHook(hooks, 'after-task', {
        task_id: taskId, status: 'failed', summary: merge.error || '', ...taskContext,
      }, { ctxManager });
      return { ok: false, error: merge.error };
    }
  }

  await tryHook(hooks, 'after-task', {
    task_id: taskId, status: 'implemented', summary: '', ...taskContext,
  }, { ctxManager });

  return { ok: true };
}
