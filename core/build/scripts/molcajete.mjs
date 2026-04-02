#!/usr/bin/env node

// molcajete.mjs — CLI entry point for Molcajete.ai commands.
//
// Usage:
//   molcajete build <plan-name>   Run all pending tasks in sequence

import { execSync, spawn } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  readdirSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);
const PLUGIN_DIR = resolve(SCRIPT_DIR, '../..');

// ── Config ──

const BACKOFF_BASE = parseInt(process.env.MOLCAJETE_BACKOFF_BASE ?? '30', 10);
const MAX_TURNS_AGENT = process.env.MOLCAJETE_MAX_TURNS_AGENT ?? '50';
const BUDGET_AGENT = process.env.MOLCAJETE_BUDGET_AGENT ?? '5.00';
const TIMEOUT = parseInt(process.env.MOLCAJETE_TASK_TIMEOUT ?? '897', 10) * 1000;
const MAX_DEV_VALIDATE_CYCLES = 7;

/** Currently spawned child process — killed on SIGINT/SIGTERM. */
let activeChild = null;

// ── JSON Schemas for Session Outputs ──

const DEV_SESSION_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'failed'] },
    files_modified: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    key_decisions: { type: 'array', items: { type: 'string' } },
    error: { type: ['string', 'null'] },
  },
  required: ['status', 'files_modified', 'summary'],
};

const VALIDATE_SESSION_SCHEMA = {
  type: 'object',
  properties: {
    formatting: { type: 'array', items: { type: 'string' } },
    linting: { type: 'array', items: { type: 'string' } },
    bdd_tests: { type: 'array', items: { type: 'string' } },
    code_review: { type: 'array', items: { type: 'string' } },
    completeness: { type: 'array', items: { type: 'string' } },
  },
  required: ['formatting', 'linting', 'code_review', 'completeness'],
};

const ENV_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'failed'] },
    failures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['status', 'failures', 'summary'],
};

const FINAL_TESTS_SCHEMA = {
  type: 'object',
  properties: {
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['failures'],
};

const WORKTREE_FIX_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['resolved', 'failed'] },
    worktree_path: { type: 'string' },
    action_taken: { type: 'string' },
    error: { type: ['string', 'null'] },
  },
  required: ['status', 'worktree_path'],
};

const COMMIT_SESSION_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'failed'] },
    commits: { type: 'array', items: { type: 'string' } },
    error: { type: ['string', 'null'] },
  },
  required: ['status', 'commits'],
};

// ── Subcommands ──

const commands = {
  build: runBuild,
};

// ── CLI Router ──

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  printUsage();
  process.exit(1);
}

const subcommand = args[0];
const handler = commands[subcommand];

if (!handler) {
  process.stderr.write(`Unknown command: ${subcommand}\n\n`);
  printUsage();
  process.exit(1);
}

handler(args.slice(1));

// ── Usage ──

function printUsage() {
  process.stderr.write(`Usage: molcajete <command> [options]

Commands:
  build <plan-name>    Execute all pending tasks in sequence

Options:
  --help, -h    Show this help message

Examples:
  molcajete build 202603261430-user-authentication
  molcajete build user-authentication
`);
}

// ── Utilities ──

function log(...args) {
  const ts = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[${ts}] ${args.join(' ')}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Check if an ID is a sub-task (T-NNN-M format). */
function isSubTaskId(id) {
  return /^T-\d{3}-\d+$/.test(id);
}

/** Extract parent task ID from a sub-task ID. */
function parentTaskId(subTaskId) {
  return subTaskId.replace(/-\d+$/, '');
}

// ── Plan JSON Helpers ──

function readPlan(planPath) {
  return JSON.parse(readFileSync(planPath, 'utf8'));
}

function writePlan(planPath, data) {
  const tmp = `${planPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, planPath);
}

function updatePlanJson(planPath, mutator) {
  const data = readPlan(planPath);
  mutator(data);
  writePlan(planPath, data);
}

function findTask(data, taskId) {
  return data.tasks.find((t) => t.id === taskId);
}

function findSubTask(data, subTaskId) {
  const parentId = parentTaskId(subTaskId);
  const task = findTask(data, parentId);
  if (!task || !task.sub_tasks) return null;
  return task.sub_tasks.find((st) => st.id === subTaskId);
}

function updateSubTaskStatus(planPath, subTaskId, status, extra = {}) {
  updatePlanJson(planPath, (data) => {
    const parentId = parentTaskId(subTaskId);
    const task = findTask(data, parentId);
    if (!task || !task.sub_tasks) return;
    const st = task.sub_tasks.find((s) => s.id === subTaskId);
    if (st) {
      st.status = status;
      Object.assign(st, extra);
    }
  });
}

// ── Dependency Checking ──

/**
 * Check if all dependencies for a task are satisfied.
 * @returns 0 = all deps done, 1 = a dep failed, 2 = a dep still pending/in_progress
 */
function checkDependencies(data, taskId) {
  const task = findTask(data, taskId);
  if (!task) return 0;
  const deps = task.depends_on || [];

  for (const depId of deps) {
    const dep = findTask(data, depId);
    if (!dep) continue;
    if (dep.status === 'implemented') continue;
    if (dep.status === 'failed') return 1;
    return 2;
  }
  return 0;
}

/**
 * Check sub-task dependencies within a task.
 * @returns 0 = all deps done, 1 = a dep failed, 2 = a dep still pending/in_progress
 */
function checkSubTaskDeps(task, subTaskId) {
  if (!task.sub_tasks) return 0;
  const st = task.sub_tasks.find((s) => s.id === subTaskId);
  if (!st) return 0;
  const deps = st.depends_on || [];

  for (const depId of deps) {
    const dep = task.sub_tasks.find((s) => s.id === depId);
    if (!dep) continue;
    if (dep.status === 'implemented') continue;
    if (dep.status === 'failed') return 1;
    return 2;
  }
  return 0;
}

// ── Plan File Manipulation ──

function updatePlanLevelStatus(planFile, taskCount, doneCount, failedCount) {
  let newStatus;
  if (doneCount === taskCount) {
    newStatus = 'implemented';
  } else if (failedCount > 0) {
    newStatus = 'failed';
  } else {
    return;
  }

  updatePlanJson(planFile, (data) => {
    data.status = newStatus;
  });
}

// ── PRD Status Propagation ──

function updatePrdStatuses(projectRoot, planFile) {
  const prdDir = join(projectRoot, 'prd');
  if (!existsSync(prdDir)) {
    log('Warning: prd/ directory not found — skipping PRD status update');
    return;
  }

  const data = readPlan(planFile);

  const doneTags = new Set();
  const implementedUcs = new Set();
  for (const task of data.tasks) {
    if (task.status === 'implemented') {
      for (const tag of task.done_tags || []) doneTags.add(tag);
      for (const uc of task.use_cases || []) implementedUcs.add(uc);
    }
  }

  if (doneTags.size === 0 || implementedUcs.size === 0) return;

  const affectedFeatures = new Set();
  const domainsDir = join(prdDir, 'domains');
  if (!existsSync(domainsDir)) return;

  for (const ucId of implementedUcs) {
    const ucFile = findFile(domainsDir, `use-cases/${ucId}.md`);
    if (!ucFile) {
      log(`Warning: UC file not found for ${ucId} — skipping`);
      continue;
    }

    const ucContent = readFileSync(ucFile, 'utf8');
    const scenarioIds = [];
    for (const match of ucContent.matchAll(/^### (SC-[A-Za-z0-9]+)/gm)) {
      scenarioIds.push(match[1]);
    }
    if (scenarioIds.length === 0) continue;

    const allCovered = scenarioIds.every((sc) => doneTags.has(`@${sc}`));
    if (!allCovered) continue;

    let ucText = readFileSync(ucFile, 'utf8');
    ucText = ucText.replace(/^status: (pending|dirty)$/m, 'status: implemented');
    writeFileSync(ucFile, ucText);

    const featureDir = dirname(dirname(ucFile));
    const useCasesIndex = join(featureDir, 'USE-CASES.md');
    if (existsSync(useCasesIndex)) {
      let indexContent = readFileSync(useCasesIndex, 'utf8');
      const ucPattern = new RegExp(`(\\| *${ucId} .*)\\| *(pending|dirty) *\\|`);
      indexContent = indexContent.replace(ucPattern, '$1| implemented |');
      writeFileSync(useCasesIndex, indexContent);
    }

    affectedFeatures.add(basename(featureDir));
    log(`PRD updated: ${ucId} → implemented`);
  }

  for (const featDirName of affectedFeatures) {
    const useCasesIndex = findFile(domainsDir, `${featDirName}/USE-CASES.md`);
    if (!useCasesIndex) continue;

    const indexContent = readFileSync(useCasesIndex, 'utf8');
    const ucRows = indexContent.match(/^\| *UC-.*$/gm) || [];
    const allImplemented = ucRows.every((row) =>
      /\| *implemented *\|/.test(row)
    );

    if (!allImplemented) continue;

    const domainDir = dirname(dirname(dirname(useCasesIndex)));
    const domainName = basename(domainDir);

    if (domainName === 'global') {
      log('Skipping feature status update for global domain (spec-only)');
      continue;
    }

    const featuresMd = join(projectRoot, 'prd', 'FEATURES.md');
    if (existsSync(featuresMd)) {
      let featContent = readFileSync(featuresMd, 'utf8');
      const featPattern = new RegExp(
        `(\\| *${featDirName} .*)\\| *(pending|dirty) *\\|`
      );
      featContent = featContent.replace(featPattern, '$1| implemented |');
      writeFileSync(featuresMd, featContent);
      log(`PRD updated: ${featDirName} → implemented (all UCs done)`);
    }
  }
}

/** Recursively find a file matching a suffix path under a directory. */
function findFile(dir, suffixPath) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFile(full, suffixPath);
        if (found) return found;
      } else if (full.endsWith(suffixPath)) {
        return full;
      }
    }
  } catch {
    // ignore permission errors etc.
  }
  return null;
}

// ── Plan File Resolution ──

/**
 * Resolve a plan name to a plan.json path inside a plan directory.
 * Plans are directories: .molcajete/plans/{YYYYMMDDHHmm}-{slug}/plan.json
 */
function resolvePlanFile(plansDir, name) {
  const entries = readdirSync(plansDir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && existsSync(join(plansDir, e.name, 'plan.json')))
    .map((e) => e.name);

  // Exact match
  if (dirs.includes(name)) return join(plansDir, name, 'plan.json');

  // Strip .json suffix if user passed old-style name
  const stripped = name.replace(/\.json$/, '');
  if (dirs.includes(stripped)) return join(plansDir, stripped, 'plan.json');

  // Prefix match (timestamp)
  const byPrefix = dirs.filter((d) => d.startsWith(stripped));
  if (byPrefix.length === 1) return join(plansDir, byPrefix[0], 'plan.json');

  // Substring match (slug)
  const bySlug = dirs.filter((d) => d.includes(stripped));
  if (bySlug.length === 1) return join(plansDir, bySlug[0], 'plan.json');

  if (byPrefix.length > 1 || bySlug.length > 1) {
    const matches = [...new Set([...byPrefix, ...bySlug])];
    process.stderr.write(
      `Error: ambiguous plan name "${name}". Matches:\n  ${matches.join('\n  ')}\n`
    );
    process.exit(1);
  }

  return null;
}

// ── Report Writing ──

/**
 * Write a validation/test report to the plan's reports/ directory.
 * @param {string} planDir - Absolute path to the plan directory (parent of plan.json)
 * @param {string} name - Report filename (e.g., "T-001-validate-1", "final-test")
 * @param {object} data - Report data to serialize as JSON
 */
function writeReport(planDir, name, data) {
  const reportsDir = join(planDir, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${name}.json`);
  writeFileSync(reportPath, JSON.stringify(data, null, 2) + '\n');
  log(`Report saved: ${reportPath}`);
}

// ── invokeClaude ──

async function invokeClaude(workdir, args) {
  for (let attempt = 0; attempt <= 6; attempt++) {
    const result = await spawnClaude(workdir, args);

    if (result.exitCode === 0) return result;

    if (/rate.limit|429|too many requests/i.test(result.stderr)) {
      const wait = BACKOFF_BASE * 2 ** attempt;
      log(
        `Rate limited. Retrying in ${wait}s (attempt ${attempt + 1}/6)...`
      );
      await sleep(wait * 1000);
      continue;
    }

    return result;
  }

  log('Rate limit retries exhausted.');
  return { output: '', exitCode: 1 };
}

function spawnClaude(workdir, args) {
  return new Promise((resolveP) => {
    const fullArgs = [
      '-p',
      '--print',
      '--plugin-dir',
      PLUGIN_DIR,
      '--dangerously-skip-permissions',
    ];

    fullArgs.push(...args);

    const child = spawn('claude', fullArgs, {
      cwd: workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' },
    });

    const stderrChunks = [];
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    activeChild = child;

    const DIM = '\x1b[2m';
    const RESET = '\x1b[0m';

    const chunks = [];

    child.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      process.stdout.write(`${DIM}${chunk}${RESET}`);
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, TIMEOUT);

    child.on('close', (code) => {
      clearTimeout(timer);
      activeChild = null;
      resolveP({
        output: Buffer.concat(chunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
        exitCode: code ?? 1,
      });
    });
  });
}

// ── Output Parsing ──

function extractStructuredOutput(rawOutput) {
  // With --print + --json-schema, the final stdout is the structured JSON.
  // Try parsing the full output first.
  const trimmed = rawOutput.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall back: find the last JSON object in the output
    const lastBrace = trimmed.lastIndexOf('}');
    if (lastBrace === -1) return {};
    // Walk backwards to find the matching opening brace
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (trimmed[i] === '}') depth++;
      else if (trimmed[i] === '{') depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(i, lastBrace + 1));
        } catch {
          return {};
        }
      }
    }
    return {};
  }
}

// ── Worktree Management ──

function worktreePath(projectRoot, feature, taskId) {
  return join(projectRoot, '.molcajete', 'worktrees', `${feature}-${taskId}`);
}

function worktreeBranch(feature, taskId) {
  return `dispatch/${feature}-${taskId}`;
}

/**
 * Prepare a worktree for a task. Node.js-first, Claude fallback on error.
 * @returns {{ ok: boolean, path: string, error?: string }}
 */
async function prepareWorktree(projectRoot, feature, taskId, baseBranch) {
  const wtPath = worktreePath(projectRoot, feature, taskId);
  const branch = worktreeBranch(feature, taskId);

  mkdirSync(join(projectRoot, '.molcajete', 'worktrees'), { recursive: true });

  // Check for stale worktree
  try {
    const list = execSync('git worktree list --porcelain', {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    if (list.includes(wtPath)) {
      log(`Removing stale worktree: ${wtPath}`);
      execSync(`git worktree remove --force "${wtPath}"`, { cwd: projectRoot });
    }
  } catch {
    // ignore — worktree may not exist
  }

  // Clean up stale branch
  try {
    execSync(`git branch -D "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // branch doesn't exist — fine
  }

  // Create worktree
  try {
    execSync(
      `git worktree add -b "${branch}" "${wtPath}" "${baseBranch}"`,
      { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' }
    );
    log(`Worktree ready: ${wtPath}`);
    return { ok: true, path: wtPath };
  } catch (err) {
    log(`Worktree creation failed — launching fix session`);
    return await runWorktreeFixSession(projectRoot, wtPath, branch, baseBranch, err.stderr || err.message);
  }
}

/**
 * Clean up a worktree and its branch after merge or failure.
 */
function cleanupWorktree(projectRoot, feature, taskId) {
  const wtPath = worktreePath(projectRoot, feature, taskId);
  const branch = worktreeBranch(feature, taskId);

  try {
    execSync(`git worktree remove --force "${wtPath}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // already removed or doesn't exist
  }
  try {
    execSync(`git branch -d "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // branch already deleted or not merged — try force
    try {
      execSync(`git branch -D "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
    } catch {
      // truly gone
    }
  }
}

// ── Session Runners ──

/**
 * Run the environment check session (pre-flight).
 * @returns {{ ok: boolean, failures: string[], summary: string }}
 */
async function runEnvCheck(projectRoot, planFile) {
  log('Phase 1: Pre-flight environment check');

  const result = await invokeClaude(projectRoot, [
    '--model', 'claude-sonnet-4-6',
    '--max-turns', '15',
    '--allowedTools', 'Read,Glob,Grep,Bash',
    '--json-schema', JSON.stringify(ENV_CHECK_SCHEMA),
    `/m:sessions/env-check ${planFile}`,
  ]);

  const out = extractStructuredOutput(result.output);

  if (result.exitCode !== 0 || out.status !== 'ready') {
    const failures = out.failures || ['Environment check session failed'];
    log(`Pre-flight FAILED: ${failures.join('; ')}`);
    return { ok: false, failures, summary: out.summary || 'Pre-flight failed' };
  }

  log(`Pre-flight passed: ${out.summary || 'all checks green'}`);
  return { ok: true, failures: [], summary: out.summary || '' };
}

/**
 * Run a development session.
 * @returns {{ ok: boolean, structured: object }}
 */
async function runDevSession(projectRoot, planFile, taskId, wtPath, priorSummaries, issues) {
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
    '--model', 'claude-sonnet-4-6',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
    '--max-turns', MAX_TURNS_AGENT,
    '--max-budget-usd', BUDGET_AGENT,
    '--json-schema', JSON.stringify(DEV_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/m:sessions/dev-session ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output);

  if (result.exitCode === 0 && out.status === 'done') {
    return { ok: true, structured: out };
  }

  const error = out.error || 'Dev session failed';
  log(`Dev session ${taskId}: failed (${error})`);
  return { ok: false, structured: out };
}

/**
 * Run a validation session.
 * @returns {{ ok: boolean, issues: string[], structured: object }}
 */
async function runValidationSession(projectRoot, planFile, taskId, wtPath) {
  const sessionLabel = `validate-${taskId}`;
  log(`Validation session: ${taskId}`);

  const payload = JSON.stringify({
    plan_path: planFile,
    task_id: taskId,
    worktree_path: wtPath,
  });

  const result = await invokeClaude(wtPath, [
    '--model', 'claude-sonnet-4-6',
    '--allowedTools', 'Read,Glob,Grep,Bash,Agent',
    '--max-turns', '30',
    '--max-budget-usd', BUDGET_AGENT,
    '--json-schema', JSON.stringify(VALIDATE_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/m:sessions/validate-session ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output);

  // Collect all issues from all gates
  const allIssues = [
    ...(out.formatting || []),
    ...(out.linting || []),
    ...(out.bdd_tests || []),
    ...(out.code_review || []),
    ...(out.completeness || []),
  ];

  if (allIssues.length === 0) {
    log(`Validation ${taskId}: all gates passed`);
    return { ok: true, issues: [], structured: out };
  }

  log(`Validation ${taskId}: ${allIssues.length} issues found`);
  return { ok: false, issues: allIssues, structured: out };
}

/**
 * Run the worktree fix session (Claude fallback).
 */
async function runWorktreeFixSession(projectRoot, wtPath, branch, baseBranch, errorOutput) {
  log('Worktree fix session: diagnosing failure');

  const payload = JSON.stringify({
    worktree_path: wtPath,
    branch_name: branch,
    base_branch: baseBranch,
    error_output: errorOutput,
  });

  const result = await invokeClaude(projectRoot, [
    '--model', 'claude-sonnet-4-6',
    '--max-turns', '10',
    '--allowedTools', 'Read,Bash,Glob',
    '--json-schema', JSON.stringify(WORKTREE_FIX_SCHEMA),
    `/m:sessions/worktree-fix ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output);

  if (result.exitCode === 0 && out.status === 'resolved') {
    log(`Worktree fixed: ${out.action_taken || 'resolved'}`);
    return { ok: true, path: out.worktree_path || wtPath };
  }

  const error = out.error || 'Worktree fix failed';
  log(`Worktree fix failed: ${error}`);
  return { ok: false, path: wtPath, error };
}

/**
 * Run the final test suite session (post-flight).
 * @returns {{ ok: boolean, failures: string[] }}
 */
async function runFinalTests(projectRoot, planFile) {
  log('Phase 3: Post-flight final tests');

  const payload = JSON.stringify({ plan_path: planFile });

  const result = await invokeClaude(projectRoot, [
    '--model', 'claude-sonnet-4-6',
    '--max-turns', '15',
    '--allowedTools', 'Read,Glob,Grep,Bash',
    '--json-schema', JSON.stringify(FINAL_TESTS_SCHEMA),
    `/m:sessions/final-tests ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output);
  const failures = out.failures || [];

  if (failures.length === 0) {
    log('Final tests: all tests passed');
    return { ok: true, failures: [] };
  }

  log(`Final tests: ${failures.length} failures`);
  return { ok: false, failures };
}

/**
 * Run a commit session (stage + commit after validation passes).
 * @returns {{ ok: boolean, structured: object }}
 */
async function runCommitSession(projectRoot, planFile, taskId, wtPath, devSummary, filesModified) {
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
    '--model', 'claude-sonnet-4-6',
    '--max-turns', '15',
    '--allowedTools', 'Read,Glob,Grep,Bash',
    '--json-schema', JSON.stringify(COMMIT_SESSION_SCHEMA),
    '--name', sessionLabel,
    `/m:sessions/commit-session ${payload}`,
  ]);

  const out = extractStructuredOutput(result.output);

  if (result.exitCode === 0 && out.status === 'done') {
    log(`Commit session ${taskId}: ${(out.commits || []).length} commit(s)`);
    return { ok: true, structured: out };
  }

  const error = out.error || 'Commit session failed';
  log(`Commit session ${taskId}: failed (${error})`);
  return { ok: false, structured: out };
}

// ── Dev-Validate Cycle ──

/**
 * Core dev-validate loop. Runs dev session then validation session,
 * retrying up to MAX_DEV_VALIDATE_CYCLES times.
 *
 * @param {string} taskId - Task or sub-task ID
 * @param {string[]} priorSummaries - Summaries from prior tasks/sub-tasks
 * @returns {{ ok: boolean, devResult: object, validateResult: object, error?: string }}
 */
async function runDevValidateCycle(projectRoot, planFile, taskId, wtPath, priorSummaries, planDir) {
  let issues = [];

  for (let cycle = 1; cycle <= MAX_DEV_VALIDATE_CYCLES; cycle++) {
    log(`Dev-validate cycle ${cycle}/${MAX_DEV_VALIDATE_CYCLES} for ${taskId}`);

    // Dev session (no commit)
    const dev = await runDevSession(projectRoot, planFile, taskId, wtPath, priorSummaries, issues);
    if (!dev.ok) {
      return { ok: false, devResult: dev.structured, validateResult: null, error: dev.structured?.error || 'Dev session failed' };
    }

    // Validation session
    const val = await runValidationSession(projectRoot, planFile, taskId, wtPath);

    // Save validation report
    if (planDir) {
      writeReport(planDir, `${taskId}-validate-${cycle}`, val.structured);
    }

    if (!val.ok) {
      // Feed issues to next dev session
      issues = val.issues;
      log(`Cycle ${cycle} failed with ${issues.length} issues — ${cycle < MAX_DEV_VALIDATE_CYCLES ? 'retrying' : 'exhausted'}`);
      continue;
    }

    // Validation passed — commit session
    const commit = await runCommitSession(
      projectRoot, planFile, taskId, wtPath,
      dev.structured.summary, dev.structured.files_modified
    );

    if (commit.ok) {
      return {
        ok: true,
        devResult: { ...dev.structured, commits: commit.structured.commits },
        validateResult: val.structured,
      };
    }

    // Hook failure — feed hook output as issues to next dev cycle
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

// ── Merge Worktree ──

/**
 * Merge a task's worktree branch back to the base branch.
 * Node.js-first with dev-validate fallback on conflicts.
 *
 * @returns {{ ok: boolean, error?: string }}
 */
async function mergeWorktree(projectRoot, planFile, feature, taskId, baseBranch, priorSummaries, planDir) {
  const wtPath = worktreePath(projectRoot, feature, taskId);
  const branch = worktreeBranch(feature, taskId);

  // Step 1: Rebase onto base branch
  try {
    execSync(`git -C "${wtPath}" rebase "${baseBranch}"`, { stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    log(`Rebase conflict for ${taskId} — launching dev session to resolve`);

    // Abort the failed rebase
    try {
      execSync(`git -C "${wtPath}" rebase --abort`, { stdio: 'pipe' });
    } catch {
      // may already be clean
    }

    // Dev-validate cycle to resolve conflicts
    const resolution = await runDevValidateCycle(
      projectRoot, planFile, taskId, wtPath,
      [...priorSummaries, `MERGE CONFLICT: Rebase of ${branch} onto ${baseBranch} failed. Resolve conflicts, stage files, and commit.`],
      planDir
    );

    if (!resolution.ok) {
      return { ok: false, error: `Merge conflict resolution failed: ${resolution.error}` };
    }

    // Retry rebase after fix
    try {
      execSync(`git -C "${wtPath}" rebase "${baseBranch}"`, { stdio: 'pipe', encoding: 'utf8' });
    } catch {
      return { ok: false, error: 'Rebase still failing after conflict resolution' };
    }
  }

  // Step 2: Fast-forward merge
  try {
    execSync(`git checkout "${baseBranch}"`, { cwd: projectRoot, stdio: 'pipe' });
    execSync(`git merge --no-edit "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch (err) {
    return { ok: false, error: `Fast-forward merge failed: ${err.message}` };
  }

  // Step 3: Update plan file and commit
  const data = readPlan(planFile);
  const task = findTask(data, taskId);
  if (task) {
    task.status = 'implemented';
    writePlan(planFile, data);

    try {
      execSync(`git add "${planFile}"`, { cwd: projectRoot, stdio: 'pipe' });
      execSync(`git commit -m "plan: mark ${taskId} implemented"`, { cwd: projectRoot, stdio: 'pipe' });
    } catch {
      // plan commit failed — non-fatal, the merge itself succeeded
      log(`Warning: plan commit for ${taskId} failed — plan file may be out of sync`);
    }
  }

  // Step 4: Cleanup
  cleanupWorktree(projectRoot, feature, taskId);
  log(`Merged and cleaned up: ${taskId}`);

  return { ok: true };
}

// ── Task Runners ──

/**
 * Run a simple task (no sub-tasks): dev-validate cycle then merge.
 */
async function runSimpleTask(projectRoot, planFile, task, baseBranch, priorSummaries, planDir) {
  const taskId = task.id;
  const wtPath = worktreePath(projectRoot, task.feature, taskId);

  const result = await runDevValidateCycle(projectRoot, planFile, taskId, wtPath, priorSummaries, planDir);

  if (!result.ok) {
    return { ok: false, error: result.error, devResult: result.devResult };
  }

  // Merge
  const merge = await mergeWorktree(projectRoot, planFile, task.feature, taskId, baseBranch, priorSummaries, planDir);
  if (!merge.ok) {
    return { ok: false, error: merge.error, devResult: result.devResult };
  }

  return { ok: true, devResult: result.devResult };
}

/**
 * Run a task with sub-tasks: iterate sub-tasks, then task-level validation.
 */
async function runTaskWithSubTasks(projectRoot, planFile, task, baseBranch, priorSummaries, planDir) {
  const taskId = task.id;
  const wtPath = worktreePath(projectRoot, task.feature, taskId);
  const subTasks = task.sub_tasks;
  const subSummaries = [...priorSummaries];

  // Run each sub-task sequentially
  for (const st of subTasks) {
    const stId = st.id;

    // Check sub-task dependencies
    const freshData = readPlan(planFile);
    const freshTask = findTask(freshData, taskId);
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
    updateSubTaskStatus(planFile, stId, 'in_progress');

    // Dev-validate cycle for sub-task (validation skips BDD because ID is T-NNN-M)
    const result = await runDevValidateCycle(projectRoot, planFile, stId, wtPath, subSummaries, planDir);

    if (!result.ok) {
      updateSubTaskStatus(planFile, stId, 'failed', { error: result.error });
      return { ok: false, error: `Sub-task ${stId} failed: ${result.error}` };
    }

    // Update sub-task as implemented
    updateSubTaskStatus(planFile, stId, 'implemented', {
      summary: result.devResult?.summary || null,
      commits: result.devResult?.commits || [],
      quality_gates: result.validateResult || null,
    });

    if (result.devResult?.summary) subSummaries.push(result.devResult.summary);
    log(`Sub-task ${stId}: implemented`);
  }

  // Task-level validation with BDD (using task ID T-NNN, not sub-task ID)
  log(`Running task-level validation for ${taskId} (with BDD)`);
  let valCycleCount = 0;
  const taskVal = await runValidationSession(projectRoot, planFile, taskId, wtPath);
  valCycleCount++;
  if (planDir) writeReport(planDir, `${taskId}-validate-${valCycleCount}`, taskVal.structured);

  if (!taskVal.ok) {
    // Task-level validation failed — dev session gets full task scope
    log(`Task-level validation failed for ${taskId} — launching fix cycle`);
    let fixIssues = taskVal.issues;

    for (let cycle = 1; cycle <= MAX_DEV_VALIDATE_CYCLES; cycle++) {
      log(`Task-level fix cycle ${cycle}/${MAX_DEV_VALIDATE_CYCLES} for ${taskId}`);

      const dev = await runDevSession(projectRoot, planFile, taskId, wtPath, subSummaries, fixIssues);
      if (!dev.ok) {
        return { ok: false, error: `Task-level fix failed: ${dev.structured?.error || 'Dev session failed'}` };
      }

      const reVal = await runValidationSession(projectRoot, planFile, taskId, wtPath);
      valCycleCount++;
      if (planDir) writeReport(planDir, `${taskId}-validate-${valCycleCount}`, reVal.structured);

      if (!reVal.ok) {
        if (cycle === MAX_DEV_VALIDATE_CYCLES) {
          return { ok: false, error: `Task-level validation exhausted after ${MAX_DEV_VALIDATE_CYCLES} fix cycles` };
        }
        fixIssues = reVal.issues;
        continue;
      }

      // Validation passed — commit session
      const commit = await runCommitSession(
        projectRoot, planFile, taskId, wtPath,
        dev.structured.summary, dev.structured.files_modified
      );

      if (commit.ok) break;

      // Hook failure — feed hook output as issues to next cycle
      if (cycle === MAX_DEV_VALIDATE_CYCLES) {
        return { ok: false, error: `Task-level fix exhausted after ${MAX_DEV_VALIDATE_CYCLES} cycles (last: commit hook failure)` };
      }
      fixIssues = [`Commit hook failure:\n${commit.structured.error}`];
    }
  }

  // Merge
  const merge = await mergeWorktree(projectRoot, planFile, task.feature, taskId, baseBranch, subSummaries, planDir);
  if (!merge.ok) {
    return { ok: false, error: merge.error };
  }

  return { ok: true };
}

// ── Build Command ──

async function runBuild(args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stderr.write(`Usage: molcajete build <plan-name>

Resolves <plan-name> to a plan file in .molcajete/plans/ and runs all
pending tasks in dependency order.

Single-task execution is available interactively via /m:build <plan> <task-id>.

The plan name can be:
  - Full filename:  202603261430-user-authentication.json
  - Stem:           202603261430-user-authentication
  - Slug only:      user-authentication (fuzzy match)
  - Timestamp only: 202603261430 (prefix match)
`);
    process.exit(1);
  }

  const positionalArgs = args.filter((a) => !a.startsWith('--'));
  const planName = positionalArgs[0];

  if (!planName) {
    process.stderr.write('Error: plan name required\n');
    process.exit(1);
  }

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
      `Error: plan not found: ${planName}\n\nAvailable plans:\n  ${available || '(none)'}\n`
    );
    process.exit(1);
  }

  const projectRoot = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf8',
  }).trim();

  const planDir = dirname(planFile);
  const planRelative = basename(planDir);

  // Check for apps.md
  const appsPath = join(projectRoot, '.molcajete/apps.md');
  if (!existsSync(appsPath)) {
    log('Warning: .molcajete/apps.md not found — run /m:setup to configure');
  }

  await runAllTasksMode(projectRoot, planRelative, planFile, planDir);
}

// ── Main Orchestrator Loop ──

async function runAllTasksMode(projectRoot, planName, planFile, planDir) {
  log(`Starting build: all pending tasks from ${planName}`);

  // Reset failed tasks back to pending so they are retried
  updatePlanJson(planFile, (d) => {
    for (const t of d.tasks) {
      if (t.status === 'failed') {
        t.status = 'pending';
        t.error = null;
      }
      // Also reset failed sub-tasks
      if (t.sub_tasks) {
        for (const st of t.sub_tasks) {
          if (st.status === 'failed') {
            st.status = 'pending';
            st.error = null;
          }
        }
      }
    }
    if (d.status === 'failed') d.status = 'pending';
  });

  const data = readPlan(planFile);
  const baseBranch = data.base_branch || 'main';

  // ── Phase 1: Pre-flight ──

  const envCheck = await runEnvCheck(projectRoot, planFile);
  if (!envCheck.ok) {
    log('BUILD ABORTED: pre-flight environment check failed');
    for (const f of envCheck.failures) log(`  - ${f}`);
    updatePlanJson(planFile, (d) => { d.status = 'failed'; });
    process.exit(1);
  }

  // ── Phase 2: Task Loop ──

  const taskCount = data.tasks.length;
  let doneCount = 0;
  let failedCount = 0;

  // Count already-done tasks
  for (const task of data.tasks) {
    if (task.status === 'implemented') doneCount++;
  }

  updatePlanJson(planFile, (d) => { d.status = 'in_progress'; });

  for (const task of data.tasks) {
    const taskId = task.id;

    // Skip already completed
    if (task.status === 'implemented') continue;

    // Re-read to get latest status
    const freshData = readPlan(planFile);
    const freshTask = findTask(freshData, taskId);

    if (freshTask.status === 'implemented') continue;

    log(`━━━ Task: ${taskId} — ${freshTask.title} ━━━`);

    // Check dependencies
    const depResult = checkDependencies(freshData, taskId);

    if (depResult === 1) {
      log(`Skipping ${taskId}: dependency failed`);
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        t.status = 'failed';
        t.error = 'Dependency failed';
      });
      failedCount++;
      continue;
    }

    if (depResult === 2) {
      log(`Skipping ${taskId}: dependency not yet implemented`);
      continue;
    }

    // Mark in_progress
    updatePlanJson(planFile, (d) => {
      findTask(d, taskId).status = 'in_progress';
    });

    // Prepare worktree
    const wt = await prepareWorktree(projectRoot, freshTask.feature, taskId, baseBranch);
    if (!wt.ok) {
      log(`Task ${taskId}: worktree preparation failed`);
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        t.status = 'failed';
        t.error = wt.error || 'Worktree preparation failed';
      });
      failedCount++;
      log(`Task ${taskId}: failed — stopping build`);
      break;
    }

    // Collect prior summaries
    const priorSummaries = [];
    for (const t of freshData.tasks) {
      if (t.status === 'implemented' && t.summary) {
        priorSummaries.push(t.summary);
      }
    }

    // Run task (simple or with sub-tasks)
    let result;
    if (freshTask.sub_tasks && freshTask.sub_tasks.length > 0) {
      result = await runTaskWithSubTasks(projectRoot, planFile, freshTask, baseBranch, priorSummaries, planDir);
    } else {
      result = await runSimpleTask(projectRoot, planFile, freshTask, baseBranch, priorSummaries, planDir);
    }

    if (result.ok) {
      // Update plan with summary from dev result
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        t.status = 'implemented';
        t.error = null;
        if (result.devResult?.summary) t.summary = result.devResult.summary;
        if (result.devResult?.commits) t.commits = result.devResult.commits;
      });
      doneCount++;
      log(`Task ${taskId}: implemented`);
    } else {
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        t.status = 'failed';
        t.error = result.error || 'Task failed';
      });
      // Clean up worktree on failure
      cleanupWorktree(projectRoot, freshTask.feature, taskId);
      failedCount++;
      log(`Task ${taskId}: failed — stopping build`);
      break;
    }
  }

  // ── Phase 3: Post-flight ──

  if (failedCount === 0 && doneCount === taskCount) {
    const finalResult = await runFinalTests(projectRoot, planFile);

    // Save final tests report
    writeReport(planDir, 'final-test', { failures: finalResult.failures });

    if (!finalResult.ok) {
      log('Final tests failures detected — launching plan-level fix cycle');

      // Plan-level dev-validate cycle (not bound to a single task)
      let planFixOk = false;
      let planIssues = finalResult.failures;

      for (let cycle = 1; cycle <= MAX_DEV_VALIDATE_CYCLES; cycle++) {
        log(`Plan-level fix cycle ${cycle}/${MAX_DEV_VALIDATE_CYCLES}`);

        // Dev session at project root (plan scope, not task scope)
        const dev = await runDevSession(
          projectRoot, planFile, 'plan-level', projectRoot,
          [], planIssues
        );

        if (!dev.ok) {
          log('Plan-level dev session failed');
          break;
        }

        // Re-run final tests
        const reCheck = await runFinalTests(projectRoot, planFile);
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

    // PRD status propagation
    if (failedCount === 0) {
      updatePrdStatuses(projectRoot, planFile);
    }
  }

  // Update plan-level status
  updatePlanLevelStatus(planFile, taskCount, doneCount, failedCount);

  // ── Completion Report ──

  log('━━━ Build Complete ━━━');
  log(
    `Implemented: ${doneCount} | Failed: ${failedCount} | Total: ${taskCount}`
  );

  process.stdout.write('\nTask Status:\n');
  const finalData = readPlan(planFile);
  for (const task of finalData.tasks) {
    const status = task.status.padEnd(12);
    const error = task.error ? ` (${task.error})` : '';
    process.stdout.write(`  ${task.id.padEnd(8)}  ${status} ${task.title}${error}\n`);

    // Print sub-task statuses
    if (task.sub_tasks) {
      for (const st of task.sub_tasks) {
        const stStatus = st.status.padEnd(12);
        const stError = st.error ? ` (${st.error})` : '';
        process.stdout.write(`    ${st.id.padEnd(10)}  ${stStatus} ${st.title}${stError}\n`);
      }
    }
  }

  process.exit(failedCount === 0 ? 0 : 1);
}

// ── Signal Handlers ──

process.on('SIGINT', () => {
  if (activeChild) activeChild.kill('SIGINT');
  process.exit(130);
});

process.on('SIGTERM', () => {
  if (activeChild) activeChild.kill('SIGTERM');
  process.exit(143);
});
