import { execSync } from 'node:child_process';
import type { HookMap, DevSessionOutput, ValidateSessionOutput, CommitSessionOutput, DocSessionOutput, ValidationResult, Task, PlanData } from '../../types.js';
import {
  DEV_SESSION_SCHEMA,
  VALIDATE_SESSION_SCHEMA,
  WORKTREE_FIX_SCHEMA,
  COMMIT_SESSION_SCHEMA,
  DOC_SESSION_SCHEMA,
  MAX_TURNS_AGENT,
  BUDGET_AGENT,
} from '../../lib/config.js';
import { log, isSubTaskId, parentTaskId } from '../../lib/utils.js';
import { invokeClaude, extractStructuredOutput } from '../lib/claude.js';
import { runHook, tryHook } from '../lib/hooks.js';
import { readPlan, findTask } from './plan-data.js';

// ── Pre-flight ──

export async function runPreFlight(
  hooks: HookMap,
  planFile: string,
): Promise<{ ok: boolean; failures: string[]; summary: string }> {
  log('Pre-flight: running baseline BDD tests');
  const failures: string[] = [];

  const data = readPlan(planFile);
  const scopeTags = (data.scope || []).map((s) => `@${s}`);
  const tags = scopeTags.length > 0
    ? [`(${scopeTags.join(' or ')}) and not @pending and not @dirty`]
    : [];

  const testResult = await runHook(hooks['run-tests'], {
    tags,
    scope: 'preflight',
  }, { timeout: 300000 });

  if (!testResult.ok) {
    failures.push(`Run-tests hook failed: ${testResult.stderr}`);
  } else if ((testResult.data as Record<string, unknown>).status === 'error') {
    failures.push(...((testResult.data as Record<string, unknown>).failures as string[] || ['Test infrastructure error']));
  } else if ((testResult.data as Record<string, unknown>).status === 'fail') {
    failures.push(...((testResult.data as Record<string, unknown>).failures as string[] || ['Pre-flight tests failed']));
  }

  if (failures.length > 0) {
    log(`Pre-flight FAILED: ${failures.join('; ')}`);
    return { ok: false, failures, summary: 'Pre-flight tests failed' };
  }

  const summary = ((testResult.data as Record<string, unknown>).summary as string) || 'All checks green';
  log(`Pre-flight passed: ${summary}`);
  return { ok: true, failures: [], summary };
}

// ── Dev Session ──

export async function runDevSession(
  projectRoot: string,
  planFile: string,
  taskId: string,
  wtPath: string,
  priorSummaries: string[],
  issues: string[],
): Promise<{ ok: boolean; structured: DevSessionOutput }> {
  const sessionLabel = `dev-${taskId}`;
  log(`Dev session: ${taskId}${issues.length ? ` (retry, ${issues.length} issues)` : ''}`);

  const payload = JSON.stringify({
    plan_path: planFile,
    task_id: taskId,
    worktree_path: wtPath,
    prior_summaries: priorSummaries,
    issues,
  });

  const result = await invokeClaude(wtPath, [
    '--model', 'opus',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
    '--max-turns', MAX_TURNS_AGENT,
    '--max-budget-usd', BUDGET_AGENT,
    '--json-schema', JSON.stringify(DEV_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/m:sessions/dev-session ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output) as unknown as DevSessionOutput;

  if (result.exitCode === 0 && out.status === 'done') {
    return { ok: true, structured: out };
  }

  const error = out.error || 'Dev session failed';
  log(`Dev session ${taskId}: failed (${error})`);
  return { ok: false, structured: out };
}

// ── Validation Session ──

export async function runValidationSession(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  taskId: string,
  wtPath: string,
  opts: { filesModified?: string[]; taskContext?: Record<string, unknown> } = {},
): Promise<ValidationResult> {
  log(`Validation: ${taskId}`);

  const data = readPlan(planFile);
  const isSub = isSubTaskId(taskId);
  let task: Task | undefined;
  if (isSub) {
    const pId = parentTaskId(taskId);
    task = findTask(data, pId);
  } else {
    task = findTask(data, taskId);
  }

  const domain = task?.domain || '';
  const services = domain ? [domain, 'bdd'] : ['bdd'];
  const filesModified = opts.filesModified || [];
  const taskContext = opts.taskContext || {};

  const allIssues: string[] = [];
  const structured: ValidateSessionOutput = {
    formatting: [],
    linting: [],
    bdd_tests: [],
    code_review: [],
    completeness: [],
  };

  // Format then lint (sequential)
  const fmtResult = await runHook(hooks['format'], { files: filesModified, services, ...taskContext }, { timeout: 60000, cwd: wtPath });
  if (!fmtResult.ok) {
    allIssues.push(`Format hook failed: ${fmtResult.stderr}`);
    structured.formatting!.push(`Format hook failed: ${fmtResult.stderr}`);
  } else if ((fmtResult.data as Record<string, unknown>).status === 'fail') {
    structured.formatting = (fmtResult.data as Record<string, unknown>).issues as string[] || [];
    allIssues.push(...structured.formatting);
  }

  const lintResult = await runHook(hooks['lint'], { files: filesModified, services, ...taskContext }, { timeout: 120000, cwd: wtPath });
  if (!lintResult.ok) {
    allIssues.push(`Lint hook failed: ${lintResult.stderr}`);
    structured.linting!.push(`Lint hook failed: ${lintResult.stderr}`);
  } else if ((lintResult.data as Record<string, unknown>).status === 'fail') {
    structured.linting = (lintResult.data as Record<string, unknown>).issues as string[] || [];
    allIssues.push(...structured.linting);
  }

  // BDD hook (task-level only, skipped for sub-tasks and null scenario)
  const scenarioTag = task?.scenario ? ['@' + task.scenario] : [];

  if (!isSub && scenarioTag.length > 0) {
    const bddResult = await runHook(hooks['run-tests'], {
      tags: scenarioTag,
      scope: 'task',
      ...taskContext,
    }, { timeout: 300000, cwd: wtPath });

    if (!bddResult.ok) {
      allIssues.push(`Run-tests hook failed: ${bddResult.stderr}`);
      structured.bdd_tests!.push(`Run-tests hook failed: ${bddResult.stderr}`);
    } else if ((bddResult.data as Record<string, unknown>).status === 'error') {
      structured.bdd_tests = (bddResult.data as Record<string, unknown>).failures as string[] || ['Test infrastructure error'];
      allIssues.push(...structured.bdd_tests);

      const logsResult = await tryHook(hooks, 'logs', { lines: 200 });
      if (logsResult?.ok && (logsResult.data as Record<string, unknown>).logs) {
        const logSnippet = ((logsResult.data as Record<string, unknown>).logs as string).slice(0, 2000);
        allIssues.push(`Environment logs:\n${logSnippet}`);
      }

      log(`Validation ${taskId}: BDD setup error — hard stop (skipping Claude gates)`);
      return { ok: false, issues: allIssues, structured, hardStop: true };
    } else if ((bddResult.data as Record<string, unknown>).status === 'fail') {
      structured.bdd_tests = (bddResult.data as Record<string, unknown>).failures as string[] || [];
      allIssues.push(...structured.bdd_tests);
    }
  }

  // Lifecycle hook: before-validate
  await tryHook(hooks, 'before-validate', { task_id: taskId, services, ...taskContext });

  // Claude gates: code-review + completeness
  const sessionLabel = `validate-${taskId}`;
  const payload = JSON.stringify({
    plan_path: planFile,
    task_id: taskId,
    worktree_path: wtPath,
  });

  const result = await invokeClaude(wtPath, [
    '--model', 'sonnet',
    '--allowedTools', 'Read,Glob,Grep,Bash,Agent',
    '--max-turns', '30',
    '--max-budget-usd', BUDGET_AGENT,
    '--json-schema', JSON.stringify(VALIDATE_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/m:sessions/validate-session ${payload}`,
  ]);

  const claudeOut = extractStructuredOutput(result.output);
  structured.code_review = (claudeOut.code_review as string[]) || [];
  structured.completeness = (claudeOut.completeness as string[]) || [];
  allIssues.push(...structured.code_review, ...structured.completeness);

  // Lifecycle hook: after-validate
  await tryHook(hooks, 'after-validate', { task_id: taskId, services, gate_results: structured, ...taskContext });

  if (allIssues.length === 0) {
    log(`Validation ${taskId}: all gates passed`);
    return { ok: true, issues: [], structured };
  }

  log(`Validation ${taskId}: ${allIssues.length} issues found`);
  return { ok: false, issues: allIssues, structured };
}

// ── Worktree Fix Session ──

export async function runWorktreeFixSession(
  projectRoot: string,
  wtPath: string,
  branch: string,
  baseBranch: string,
  errorOutput: string,
): Promise<{ ok: boolean; path: string; error?: string }> {
  log('Worktree fix session: diagnosing failure');

  const payload = JSON.stringify({
    worktree_path: wtPath,
    branch_name: branch,
    base_branch: baseBranch,
    error_output: errorOutput,
  });

  const result = await invokeClaude(projectRoot, [
    '--model', 'claude-haiku-4-5',
    '--max-turns', '10',
    '--allowedTools', 'Read,Bash,Glob',
    '--json-schema', JSON.stringify(WORKTREE_FIX_SCHEMA),
    `/m:sessions/worktree-fix ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output);

  if (result.exitCode === 0 && out.status === 'resolved') {
    log(`Worktree fixed: ${(out.action_taken as string) || 'resolved'}`);
    return { ok: true, path: (out.worktree_path as string) || wtPath };
  }

  const error = (out.error as string) || 'Worktree fix failed';
  log(`Worktree fix failed: ${error}`);
  return { ok: false, path: wtPath, error };
}

// ── Final Tests ──

export async function runFinalTests(
  hooks: HookMap,
  planFile: string,
): Promise<{ ok: boolean; failures: string[] }> {
  log('Phase 3: Post-flight final tests');

  const data = readPlan(planFile);
  const scopeTags = (data.scope || []).map((s) => `@${s}`);
  const tags = scopeTags.length > 0
    ? [`(${scopeTags.join(' or ')}) and not @pending and not @dirty`]
    : [];

  const result = await runHook(hooks['run-tests'], {
    tags,
    scope: 'final',
  }, { timeout: 300000 });

  if (!result.ok) {
    const failures = [`Run-tests hook failed: ${result.stderr}`];
    log('Final tests: hook error');
    return { ok: false, failures };
  }

  if ((result.data as Record<string, unknown>).status === 'pass') {
    log('Final tests: all tests passed');
    return { ok: true, failures: [] };
  }

  const failures = ((result.data as Record<string, unknown>).failures as string[]) || [`Tests failed: ${(result.data as Record<string, unknown>).status}`];
  log(`Final tests: ${failures.length} failures`);
  return { ok: false, failures };
}

// ── Commit Session ──

export async function runCommitSession(
  projectRoot: string,
  planFile: string,
  taskId: string,
  wtPath: string,
  devSummary: string,
  filesModified: string[],
): Promise<{ ok: boolean; structured: CommitSessionOutput }> {
  const sessionLabel = `commit-${taskId}`;
  log(`Commit session: ${taskId}`);

  const payload = JSON.stringify({
    plan_path: planFile,
    task_id: taskId,
    worktree_path: wtPath,
    dev_summary: devSummary,
    files_modified: filesModified,
  });

  const result = await invokeClaude(wtPath, [
    '--model', 'claude-haiku-4-5',
    '--max-turns', '15',
    '--allowedTools', 'Read,Glob,Grep,Bash',
    '--json-schema', JSON.stringify(COMMIT_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/m:sessions/commit-session ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output) as unknown as CommitSessionOutput;

  if (result.exitCode === 0 && out.status === 'done') {
    log(`Commit session ${taskId}: ${(out.commits || []).length} commit(s)`);
    return { ok: true, structured: out };
  }

  const error = out.error || 'Commit session failed';
  log(`Commit session ${taskId}: failed (${error})`);
  return { ok: false, structured: out };
}

// ── Doc Session ──

export async function runDocSession(
  projectRoot: string,
  planFile: string,
  task: Task,
  wtPath: string,
  devSummary: string,
  filesModified: string[],
): Promise<{ ok: boolean; structured: DocSessionOutput }> {
  const taskId = task.id;
  const sessionLabel = `doc-${taskId}`;
  log(`Doc session: ${taskId}`);

  const payload = JSON.stringify({
    plan_path: planFile,
    task_id: taskId,
    worktree_path: wtPath,
    intent: task.intent,
    files_modified: filesModified,
    dev_summary: devSummary,
  });

  const result = await invokeClaude(wtPath, [
    '--model', 'claude-haiku-4-5',
    '--max-turns', '30',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash,Agent',
    '--json-schema', JSON.stringify(DOC_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/m:sessions/doc-session ${payload}`,
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
  wtPath: string,
  taskId: string,
  docFiles: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!docFiles || docFiles.length === 0) return { ok: true };

  try {
    for (const f of docFiles) {
      execSync(`git add "${f}"`, { cwd: wtPath, stdio: 'pipe' });
    }

    try {
      execSync('git diff --cached --quiet', { cwd: wtPath, stdio: 'pipe' });
      log(`Doc commit ${taskId}: no changes to commit`);
      return { ok: true };
    } catch {
      // There are staged changes — proceed
    }

    execSync(
      `git commit -m "docs: update documentation for ${taskId}"`,
      { cwd: wtPath, stdio: 'pipe' },
    );
    log(`Doc commit ${taskId}: committed`);
    return { ok: true };
  } catch (err) {
    log(`Doc commit ${taskId}: warning — ${(err as Error).message}`);
    return { ok: false, error: (err as Error).message };
  }
}
