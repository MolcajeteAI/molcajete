import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { log, run } from '../../lib/utils.js';
import { MAX_DEV_VALIDATE_CYCLES } from '../../lib/config.js';
import { readPlan, readSettings, findTask, updatePlanJson, updatePlanLevelStatus, resolvePlanFile } from './plan-data.js';
import { discoverHooks, validateMandatoryHooks, startEnvironment, stopEnvironment, tryHook } from '../lib/hooks.js';
import { buildStats, formatDuration } from '../lib/claude.js';
import { writeReport } from './reports.js';
import { buildTaskContext } from './cycle.js';
import { prepareWorktree, cleanupWorktree, setWorktreeFixSession } from './worktree.js';
import { runPreFlight, runFinalTests, runDevSession } from './sessions.js';
import { runSimpleTask, runTaskWithSubTasks } from './tasks.js';
import { updatePrdStatuses } from './prd.js';
import { runWorktreeFixSession } from './sessions.js';
import { HookContextManager } from '../../lib/hook-context.js';
import { NullRegistry } from '../../lib/global-registry.js';
import type { HookMap, InstanceInfo } from '../../types.js';

// Wire up worktree fix session
setWorktreeFixSession(runWorktreeFixSession);

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

  // Extract planTimestamp from directory name (format: YYYYMMDDHHmm-slug)
  const planTimestamp = planRelative.match(/^(\d{12})/)?.[1] || planRelative;

  const hooks = await discoverHooks(projectRoot);
  validateMandatoryHooks(hooks);

  // Create context manager for v2 hooks
  const instance: InstanceInfo = {
    cwd: projectRoot,
    planId: planTimestamp,
    pid: process.pid,
    id: randomUUID().slice(0, 8),
  };

  // Use NullRegistry for now — Phase 6 replaces with real GlobalRegistry
  const registry = new NullRegistry();
  const ctxManager = new HookContextManager(instance, registry);
  ctxManager.newPlanScope();

  await runAllTasksMode(hooks, projectRoot, planRelative, planFile, planDir, planTimestamp, ctxManager, opts.resume);
}

// ── Main Orchestrator Loop ──

async function runAllTasksMode(
  hooks: HookMap,
  projectRoot: string,
  planName: string,
  planFile: string,
  planDir: string,
  planTimestamp: string,
  ctxManager: HookContextManager,
  resume?: boolean,
): Promise<void> {
  log(`Starting build: all pending tasks from ${planName}`);

  const settings = readSettings(projectRoot);
  log(`Mode: ${settings.useWorktrees ? 'worktree' : 'serial'} | Start timeout: ${Math.round(settings.startTimeout / 1000)}s`);

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
  const baseBranch = data.base_branch || 'main';

  // Environment startup for pre-flight
  // If after-worktree-created hook exists, skip legacy start (hooks manage lifecycle)
  const hasLifecycleHooks = !!hooks['after-worktree-created'];

  if (!hasLifecycleHooks) {
    const envStart = await startEnvironment(hooks, settings, { cwd: projectRoot, ctxManager });
    if (!envStart.ok) {
      log(`BUILD ABORTED: environment startup failed — ${envStart.error}`);
      updatePlanJson(planFile, (d) => { d.status = 'failed'; });
      process.exit(1);
    }
  }

  // Phase 1: Pre-flight
  const envCheck = await runPreFlight(hooks, planFile, { ctxManager });
  if (!envCheck.ok) {
    log('BUILD ABORTED: pre-flight BDD baseline failed');
    for (const f of envCheck.failures) log(`  - ${f}`);
    if (!hasLifecycleHooks) {
      await stopEnvironment(hooks, { cwd: projectRoot, ctxManager });
    }
    updatePlanJson(planFile, (d) => { d.status = 'failed'; });
    process.exit(1);
  }

  if (settings.useWorktrees && !hasLifecycleHooks) {
    await stopEnvironment(hooks, { cwd: projectRoot, ctxManager });
  }

  // Phase 2: Task Loop
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

    // New task scope
    ctxManager.newTaskScope();

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
      ctxManager.clearTaskScope();
      continue;
    }

    if (depResult === 2) {
      log(`Skipping ${taskId}: dependency not yet implemented`);
      ctxManager.clearTaskScope();
      continue;
    }

    updatePlanJson(planFile, (d) => {
      const t = findTask(d, taskId);
      if (t) t.status = 'in_progress';
    });

    const freshTaskContext = buildTaskContext(freshData, taskId);

    let wtPath: string;

    if (settings.useWorktrees) {
      const wt = await prepareWorktree(hooks, projectRoot, baseBranch, planTimestamp, taskId, freshTaskContext, { ctxManager });
      if (!wt.ok) {
        log(`Task ${taskId}: worktree preparation failed`);
        updatePlanJson(planFile, (d) => {
          const t = findTask(d, taskId);
          if (t) {
            t.status = 'failed';
            t.errors = [wt.error || 'Worktree preparation failed'];
          }
        });
        failedCount++;
        ctxManager.clearTaskScope();
        log(`Task ${taskId}: failed — stopping build`);
        break;
      }
      wtPath = wt.path;

      // If lifecycle hooks exist, after-worktree-created already launched the environment.
      // Otherwise, use legacy startEnvironment.
      if (!hasLifecycleHooks) {
        const taskEnv = await startEnvironment(hooks, settings, { cwd: wtPath, ctxManager });
        if (!taskEnv.ok) {
          log(`Task ${taskId}: environment startup failed — ${taskEnv.error}`);
          updatePlanJson(planFile, (d) => {
            const t = findTask(d, taskId);
            if (t) {
              t.status = 'failed';
              t.errors = [taskEnv.error || 'Environment startup failed'];
            }
          });
          await cleanupWorktree(hooks, projectRoot, baseBranch, planTimestamp, taskId, freshTaskContext, { ctxManager });
          failedCount++;
          ctxManager.clearTaskScope();
          log(`Task ${taskId}: failed — stopping build`);
          break;
        }
      }
    } else {
      wtPath = projectRoot;

      // Non-worktree mode: before-task hook serves as environment launch
      // (handled inside runSimpleTask/runTaskWithSubTasks)
    }

    // Collect prior summaries
    const priorSummaries: string[] = [];
    for (const t of freshData.tasks) {
      if (t.status === 'implemented' && t.summary) {
        priorSummaries.push(t.summary);
      }
    }

    let result;
    if (freshTask.sub_tasks && freshTask.sub_tasks.length > 0) {
      result = await runTaskWithSubTasks(hooks, projectRoot, planFile, freshTask, baseBranch, planTimestamp, priorSummaries, planDir, wtPath, settings, ctxManager);
    } else {
      result = await runSimpleTask(hooks, projectRoot, planFile, freshTask, baseBranch, planTimestamp, priorSummaries, planDir, wtPath, settings, ctxManager);
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
      if (settings.useWorktrees) {
        await cleanupWorktree(hooks, projectRoot, baseBranch, planTimestamp, taskId, freshTaskContext, { ctxManager });
      }
      failedCount++;
      log(`Task ${taskId}: failed — stopping build`);
      if (settings.useWorktrees && !hasLifecycleHooks) {
        await stopEnvironment(hooks, { cwd: wtPath, ctxManager });
      }
      ctxManager.clearTaskScope();
      break;
    }

    if (settings.useWorktrees && !hasLifecycleHooks) {
      await stopEnvironment(hooks, { cwd: wtPath, ctxManager });
    }

    ctxManager.clearTaskScope();
  }

  // Phase 3: Post-flight
  if (failedCount === 0 && doneCount === taskCount) {
    if (settings.useWorktrees && !hasLifecycleHooks) {
      const postEnv = await startEnvironment(hooks, settings, { cwd: projectRoot, ctxManager });
      if (!postEnv.ok) {
        log(`Post-flight environment startup failed — ${postEnv.error}`);
        updatePlanJson(planFile, (d) => { d.status = 'failed'; });
        failedCount++;
      }
    }

    if (failedCount === 0) {
      const finalResult = await runFinalTests(hooks, planFile, { ctxManager });
      writeReport(planDir, 'final-test', { failures: finalResult.failures });

      if (!finalResult.ok) {
        log('Final tests failures detected — launching plan-level fix cycle');
        let planFixOk = false;
        let planIssues = finalResult.failures;

        for (let cycle = 1; cycle <= MAX_DEV_VALIDATE_CYCLES; cycle++) {
          log(`Plan-level fix cycle ${cycle}/${MAX_DEV_VALIDATE_CYCLES}`);

          const dev = await runDevSession(
            projectRoot, planFile, 'plan-level', projectRoot,
            [], planIssues,
          );

          if (!dev.ok) {
            log('Plan-level dev session failed');
            break;
          }

          const reCheck = await runFinalTests(hooks, planFile, { ctxManager });
          if (reCheck.ok) {
            planFixOk = true;
            break;
          }

          planIssues = reCheck.failures;
          log(`Plan-level fix cycle ${cycle}: ${planIssues.length} failures remain`);
        }

        if (!planFixOk) {
          log('Plan-level fix cycles exhausted — marking plan as failed');
          updatePlanJson(planFile, (d) => { d.status = 'failed'; });
          failedCount++;
        }
      }

      if (failedCount === 0) {
        updatePrdStatuses(projectRoot, planFile);
      }
    }
  }

  if (!hasLifecycleHooks) {
    await stopEnvironment(hooks, { cwd: projectRoot, ctxManager });
  }

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
