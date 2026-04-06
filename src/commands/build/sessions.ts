import { execSync } from 'node:child_process';
import type { HookMap, DevSessionOutput, ReviewSessionOutput, DocSessionOutput, RecoverySessionOutput, RecoveryContext, Task, VerifyHookOutput, BuildStage, Settings } from '../../types.js';
import { pushCurrentBranch } from '../../lib/git.js';
import {
  DEV_SESSION_SCHEMA,
  REVIEW_SESSION_SCHEMA,
  DOC_SESSION_SCHEMA,
  RECOVERY_SESSION_SCHEMA,
  MAX_TURNS_AGENT,
  BUDGET_AGENT,
  BUDGET_RECOVERY,
} from '../../lib/config.js';
import { log, isSubTaskId, parentTaskId } from '../../lib/utils.js';
import { invokeClaude, extractStructuredOutput } from '../lib/claude.js';
import { runHook, tryHook } from '../lib/hooks.js';
import { readPlan, findTask } from './plan-data.js';
import { buildBuildContext } from './cycle.js';

// ── Remote Push ──

/**
 * Push the current branch to the configured remote after a commit.
 * Non-fatal: logs a warning on failure, skipped silently when disabled.
 */
export function maybePushAfterCommit(settings: Settings, label: string, cwd?: string): void {
  if (settings.push === false) return;
  const result = pushCurrentBranch(settings.remote, cwd);
  if (result.ok) {
    log(`Push ${label}: ok`);
  } else if (result.skipped) {
    log(`Push ${label}: skipped — ${result.error}`);
  } else {
    log(`Push ${label}: warning — ${result.error}`);
  }
}

// ── Dev Session ──

export async function runDevSession(
  projectRoot: string,
  planFile: string,
  taskId: string,
  priorSummaries: string[],
  issues: string[],
  cwd?: string,
): Promise<{ ok: boolean; structured: DevSessionOutput }> {
  const sessionLabel = `dev-${taskId}`;
  log(`Dev session: ${taskId}${issues.length ? ` (retry, ${issues.length} issues)` : ''}`);

  const payload = JSON.stringify({
    plan_path: planFile,
    task_id: taskId,
    prior_summaries: priorSummaries,
    issues,
  });

  const result = await invokeClaude(cwd || projectRoot, [
    '--model', 'opus',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
    '--max-turns', MAX_TURNS_AGENT,
    '--max-budget-usd', BUDGET_AGENT,
    '--json-schema', JSON.stringify(DEV_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/molcajete:develop ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output) as unknown as DevSessionOutput;

  if (result.exitCode === 0 && out.status === 'done') {
    return { ok: true, structured: out };
  }

  const error = out.error || 'Dev session failed';
  log(`Dev session ${taskId}: failed (${error})`);
  return { ok: false, structured: out };
}

// ── Verify Hook ──

export async function runVerifyHook(
  hooks: HookMap,
  taskId: string,
  planFile: string,
  filesModified: string[],
  scope: 'task' | 'subtask' | 'final',
  planName?: string,
  stage?: BuildStage,
  cwd?: string,
): Promise<{ ok: boolean; issues: string[] }> {
  log(`Verify hook: ${taskId} (scope: ${scope})`);

  const data = readPlan(planFile);
  const isSub = isSubTaskId(taskId);
  const pId = isSub ? parentTaskId(taskId) : taskId;
  const task = findTask(data, pId);
  const scenarioTag = task?.scenario ? [`@${task.scenario}`] : [];

  // Get the latest commit SHA
  let commit = '';
  try {
    commit = execSync('git rev-parse HEAD', { stdio: 'pipe', ...(cwd && { cwd }) }).toString().trim();
  } catch {
    // non-fatal
  }

  const input: Record<string, unknown> = {
    task_id: taskId,
    commit,
    files: filesModified,
    tags: scenarioTag,
    scope,
  };

  if (cwd) input.cwd = cwd;

  if (planName) {
    input.build = buildBuildContext(planFile, planName, stage || 'development');
  }

  const result = await runHook(hooks['verify'], input, { timeout: 300000, cwd });

  if (!result.ok) {
    return { ok: false, issues: [`Verify hook failed: ${result.stderr}`] };
  }

  const output = result.data as unknown as VerifyHookOutput;

  if (output.status === 'success') {
    log(`Verify hook ${taskId}: passed`);
    return { ok: true, issues: [] };
  }

  const issues = output.issues || ['Verify hook reported failure'];
  log(`Verify hook ${taskId}: ${issues.length} issues`);
  return { ok: false, issues };
}

// ── Review Session ──

export async function runReviewSession(
  hooks: HookMap,
  planFile: string,
  taskId: string,
  planName?: string,
  cwd?: string,
): Promise<{ ok: boolean; issues: string[]; structured: ReviewSessionOutput }> {
  log(`Review session: ${taskId}`);

  // Lifecycle hook: before-review
  const beforeReviewInput: Record<string, unknown> = { task_id: taskId };
  if (planName) beforeReviewInput.build = buildBuildContext(planFile, planName, 'validation');
  await tryHook(hooks, 'before-review', beforeReviewInput);

  const sessionLabel = `review-${taskId}`;
  const payload = JSON.stringify({
    plan_path: planFile,
    task_id: taskId,
  });

  const result = await invokeClaude(cwd || process.cwd(), [
    '--model', 'sonnet',
    '--allowedTools', 'Read,Glob,Grep,Bash,Agent',
    '--max-turns', '30',
    '--max-budget-usd', BUDGET_AGENT,
    '--json-schema', JSON.stringify(REVIEW_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/molcajete:validate ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output) as unknown as ReviewSessionOutput;
  const allIssues = [...(out.code_review || []), ...(out.completeness || [])];

  // Lifecycle hook: after-review
  const afterReviewInput: Record<string, unknown> = { task_id: taskId, issues: allIssues };
  if (planName) afterReviewInput.build = buildBuildContext(planFile, planName, 'validation');
  await tryHook(hooks, 'after-review', afterReviewInput);

  if (allIssues.length === 0) {
    log(`Review session ${taskId}: all clear`);
    return { ok: true, issues: [], structured: out };
  }

  log(`Review session ${taskId}: ${allIssues.length} issues found`);
  return { ok: false, issues: allIssues, structured: out };
}

// ── Recovery Session ──

export async function runRecoverySession(
  projectRoot: string,
  context: RecoveryContext,
): Promise<{ ok: boolean; structured: RecoverySessionOutput }> {
  const sessionLabel = `recover-${context.failed_task_id}`;
  log(`Recovery session: ${context.failed_task_id} (stage: ${context.failed_stage})`);

  const payload = JSON.stringify(context);

  const result = await invokeClaude(projectRoot, [
    '--model', 'opus',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
    '--max-turns', MAX_TURNS_AGENT,
    '--max-budget-usd', BUDGET_RECOVERY,
    '--json-schema', JSON.stringify(RECOVERY_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/molcajete:recover ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output) as unknown as RecoverySessionOutput;

  if (result.exitCode === 0 && out.status === 'recovered') {
    log(`Recovery session ${context.failed_task_id}: recovered — ${out.summary}`);
    return { ok: true, structured: out };
  }

  const error = out.error || 'Recovery session failed';
  log(`Recovery session ${context.failed_task_id}: failed (${error})`);
  return { ok: false, structured: out };
}

// ── Doc Session ──

export async function runDocSession(
  projectRoot: string,
  planFile: string,
  task: Task,
  devSummary: string,
  filesModified: string[],
): Promise<{ ok: boolean; structured: DocSessionOutput }> {
  const taskId = task.id;
  const sessionLabel = `doc-${taskId}`;
  log(`Doc session: ${taskId}`);

  const payload = JSON.stringify({
    plan_path: planFile,
    task_id: taskId,
    intent: task.intent,
    files_modified: filesModified,
    dev_summary: devSummary,
  });

  const result = await invokeClaude(projectRoot, [
    '--model', 'claude-haiku-4-5',
    '--max-turns', '30',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash,Agent',
    '--json-schema', JSON.stringify(DOC_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/molcajete:document ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output) as unknown as DocSessionOutput;

  if (result.exitCode === 0 && out.status === 'done') {
    log(`Doc session ${taskId}: ${(out.files_modified || []).length} file(s) updated`);
    return { ok: true, structured: out };
  }

  const error = out.error || 'Doc session failed';
  log(`Doc session ${taskId}: warning — ${error}`);
  return { ok: false, structured: out };
}

// ── Doc Commit ──

export async function commitDocChanges(
  taskId: string,
  docFiles: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!docFiles || docFiles.length === 0) return { ok: true };

  try {
    for (const f of docFiles) {
      execSync(`git add "${f}"`, { stdio: 'pipe' });
    }

    try {
      execSync('git diff --cached --quiet', { stdio: 'pipe' });
      log(`Doc commit ${taskId}: no changes to commit`);
      return { ok: true };
    } catch {
      // There are staged changes — proceed
    }

    execSync(
      `git commit -m "docs: update documentation for ${taskId}"`,
      { stdio: 'pipe' },
    );
    log(`Doc commit ${taskId}: committed`);
    return { ok: true };
  } catch (err) {
    log(`Doc commit ${taskId}: warning — ${(err as Error).message}`);
    return { ok: false, error: (err as Error).message };
  }
}
