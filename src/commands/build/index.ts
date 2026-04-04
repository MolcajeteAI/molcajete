import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { log, run } from '../../lib/utils.js';
import { readPlan, findTask, updatePlanJson, updatePlanLevelStatus, resolvePlanFile } from './plan-data.js';
import { discoverHooks, validateMandatoryHooks, tryHook } from '../lib/hooks.js';
import { buildStats, formatDuration } from '../lib/claude.js';
import { writeReport } from './reports.js';
import { buildTaskContext, buildBuildContext } from './cycle.js';
import { runDocSession, commitDocChanges, runTestHook } from './sessions.js';
import { runSimpleTask, runTaskWithSubTasks } from './tasks.js';
import { updatePrdStatuses } from './prd.js';
import type { HookMap } from '../../types.js';

/**
 * Build command entry point.
 */
export async function runBuild(planName: string, opts: { resume?: boolean }): Promise<void> {
  // Resolve plan file
  const plansDir = resolve('.molcajete', 'plans');
  if (!existsSync(plansDir)) {
    process.stderr.write('Error: .molcajete/plans/ directory not found\n');
    process.exit(1);
  }

  const planFile = resolvePlanFile(plansDir, planName);
  if (!planFile) {
    const available = readdirSync(plansDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(plansDir, e.name, 'plan.json')))
      .map((e) => e.name)
      .join('\n  ');
    process.stderr.write(
      `Error: plan not found: ${planName}\n\nAvailable plans:\n  ${available || '(none)'}\n`,
    );
    process.exit(1);
  }

  const projectRoot = run('git rev-parse --show-toplevel').trim();
  const planDir = dirname(planFile);
  const planRelative = basename(planDir);

  const hooks = await discoverHooks(projectRoot);
  validateMandatoryHooks(hooks);

  await runAllTasksMode(hooks, projectRoot, planRelative, planFile, planDir, opts.resume);
}

// ── Main Orchestrator Loop ──

async function runAllTasksMode(
  hooks: HookMap,
  projectRoot: string,
  planName: string,
  planFile: string,
  planDir: string,
  resume?: boolean,
): Promise<void> {
  log(`Starting build: all pending tasks from ${planName}`);

  if (!resume) {
    // Reset failed tasks back to pending so they are retried
    updatePlanJson(planFile, (d) => {
      for (const t of d.tasks) {
        if (t.status === 'failed') {
          t.status = 'pending';
          t.errors = [];
        }
        if (t.sub_tasks) {
          for (const st of t.sub_tasks) {
            if (st.status === 'failed') {
              st.status = 'pending';
              st.errors = [];
            }
          }
        }
      }
      if (d.status === 'failed') d.status = 'pending';
    });
  }

  const data = readPlan(planFile);

  // Start hook (optional) — developer sets up environment
  const startResult = await tryHook(hooks, 'start', {
    build: buildBuildContext(planFile, planName, 'start'),
  });
  if (startResult && !startResult.ok) {
    log(`BUILD ABORTED: start hook failed — ${startResult.stderr}`);
    updatePlanJson(planFile, (d) => { d.status = 'failed'; });
    process.exit(1);
  }

  // Task Loop
  const taskCount = data.tasks.length;
  let doneCount = 0;
  let failedCount = 0;

  for (const task of data.tasks) {
    if (task.status === 'implemented') doneCount++;
  }

  updatePlanJson(planFile, (d) => { d.status = 'in_progress'; });

  for (const task of data.tasks) {
    const taskId = task.id;

    if (task.status === 'implemented') continue;

    const freshData = readPlan(planFile);
    const freshTask = findTask(freshData, taskId);
    if (!freshTask) continue;

    // In resume mode, skip already-implemented tasks
    if (freshTask.status === 'implemented') continue;

    log(`━━━ Task: ${taskId} — ${freshTask.title} ━━━`);

    // Check dependencies
    const { checkDependencies } = await import('./plan-data.js');
    const depResult = checkDependencies(freshData, taskId);

    if (depResult === 1) {
      log(`Skipping ${taskId}: dependency failed`);
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        if (t) {
          t.status = 'failed';
          t.errors = ['Dependency failed'];
        }
      });
      failedCount++;
      continue;
    }

    if (depResult === 2) {
      log(`Skipping ${taskId}: dependency not yet implemented`);
      continue;
    }

    updatePlanJson(planFile, (d) => {
      const t = findTask(d, taskId);
      if (t) t.status = 'in_progress';
    });

    // Collect prior summaries
    const priorSummaries: string[] = [];
    for (const t of freshData.tasks) {
      if (t.status === 'implemented' && t.summary) {
        priorSummaries.push(t.summary);
      }
    }

    let result;
    if (freshTask.sub_tasks && freshTask.sub_tasks.length > 0) {
      result = await runTaskWithSubTasks(hooks, projectRoot, planFile, freshTask, priorSummaries, planDir, planName);
    } else {
      result = await runSimpleTask(hooks, projectRoot, planFile, freshTask, priorSummaries, planDir, planName);
    }

    if (result.ok) {
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        if (t) {
          t.status = 'implemented';
          t.errors = [];
          const devResult = (result as Record<string, unknown>).devResult as { summary?: string } | undefined;
          if (devResult?.summary) {
            t.summary = devResult.summary;
          }
        }
      });
      doneCount++;
      log(`Task ${taskId}: implemented`);
    } else {
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        if (t) {
          t.status = 'failed';
          t.errors = [result.error || 'Task failed'];
        }
      });
      failedCount++;
      log(`Task ${taskId}: failed — stopping build`);
      break;
    }
  }

  // Doc session — updates ARCHITECTURE.md after all tasks pass
  if (failedCount === 0 && doneCount === taskCount) {
    log('━━━ Documentation Session ━━━');

    // before-documentation hook
    await tryHook(hooks, 'before-documentation', {
      build: buildBuildContext(planFile, planName, 'documentation'),
    });

    const finalData = readPlan(planFile);
    const allFiles: string[] = [];
    const allSummaries: string[] = [];

    for (const t of finalData.tasks) {
      if (t.summary) allSummaries.push(t.summary);
    }

    const lastTask = finalData.tasks[finalData.tasks.length - 1];
    if (lastTask) {
      const doc = await runDocSession(
        projectRoot, planFile, lastTask,
        allSummaries.join('\n'), allFiles,
      );
      if (doc.ok && doc.structured?.files_modified?.length > 0) {
        const docCommit = await commitDocChanges(lastTask.id, doc.structured.files_modified);
        if (!docCommit.ok) {
          log('Warning: doc commit failed — proceeding');
        }
      } else if (!doc.ok) {
        log('Warning: doc session failed — proceeding');
      }
    }

    // after-documentation hook
    await tryHook(hooks, 'after-documentation', {
      build: buildBuildContext(planFile, planName, 'documentation'),
    });

    updatePrdStatuses(projectRoot, planFile);
  }

  // Stop hook (optional) — developer tears down environment
  await tryHook(hooks, 'stop', {
    build: buildBuildContext(planFile, planName, 'stop'),
  });

  updatePlanLevelStatus(planFile, taskCount, doneCount, failedCount);

  // Completion Report
  log('━━━ Build Complete ━━━');
  log(`Implemented: ${doneCount} | Failed: ${failedCount} | Total: ${taskCount}`);
  if (buildStats.sessions > 0) {
    log(
      `Build totals: ${buildStats.sessions} sessions | Elapsed: ${formatDuration(buildStats.totalApiMs)} (Real ${formatDuration(buildStats.totalRealMs)}) | Cost: $${buildStats.totalCostUsd.toFixed(4)}`,
    );
  }

  process.stdout.write('\nTask Status:\n');
  const finalData = readPlan(planFile);
  for (const task of finalData.tasks) {
    const status = task.status.padEnd(12);
    const error = task.errors?.length ? ` (${task.errors.join('; ')})` : '';
    process.stdout.write(`  ${task.id.padEnd(10)}  ${status} ${task.title}${error}\n`);

    if (task.sub_tasks) {
      for (const st of task.sub_tasks) {
        const stStatus = st.status.padEnd(12);
        const stError = st.errors?.length ? ` (${st.errors.join('; ')})` : '';
        process.stdout.write(`    ${st.id.padEnd(14)}  ${stStatus} ${st.title}${stError}\n`);
      }
    }
  }

  process.exit(failedCount === 0 ? 0 : 1);
}
