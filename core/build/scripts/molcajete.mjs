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
    code_review: { type: 'array', items: { type: 'string' } },
    completeness: { type: 'array', items: { type: 'string' } },
  },
  required: ['code_review', 'completeness'],
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

const DOC_SESSION_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'failed'] },
    files_modified: { type: 'array', items: { type: 'string' } },
    error: { type: ['string', 'null'] },
  },
  required: ['status', 'files_modified'],
};

// ── Hook Constants ──

const MANDATORY_HOOKS = ['health-check', 'run-tests', 'format', 'lint'];
const HOOK_TIMEOUT = parseInt(process.env.MOLCAJETE_HOOK_TIMEOUT ?? '30000', 10);

// ── Subcommands ──

const commands = {
  build: runBuild,
};

// ── CLI Router ──

let DEBUG = false;

const args = process.argv.slice(2).filter((a) => {
  if (a === '--debug') { DEBUG = true; return false; }
  return true;
});

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
  --debug       Print spawned claude commands to stderr
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

/** Shell-quote a single argument (wrap in single quotes if it has special chars). */
function shellQuote(arg) {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/** Wrapper around execSync that logs commands when --debug is active. */
function run(cmd, opts = {}) {
  if (DEBUG) {
    const YELLOW = '\x1b[33m';
    const RESET = '\x1b[0m';
    process.stderr.write('\n');
    log(`${YELLOW}$ ${cmd}${RESET}`);
    log(`${YELLOW}cwd: ${opts.cwd || process.cwd()}${RESET}`);
    process.stderr.write('\n');
  }
  return execSync(cmd, opts);
}

/** Check if an ID is a sub-task (T-NNN-M format). */
function isSubTaskId(id) {
  return /^T-\d{3}-\d+$/.test(id);
}

/** Extract parent task ID from a sub-task ID. */
function parentTaskId(subTaskId) {
  return subTaskId.replace(/-\d+$/, '');
}

// ── Hook System ──

/**
 * Discover hooks in .molcajete/hooks/.
 * Returns { name: absolutePath } map, keyed by filename without extension.
 */
function discoverHooks(projectRoot) {
  const hooksDir = join(projectRoot, '.molcajete/hooks');
  if (!existsSync(hooksDir)) return {};

  const entries = readdirSync(hooksDir, { withFileTypes: true });
  const hooks = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.replace(/\.[^.]+$/, ''); // strip extension
    hooks[name] = join(hooksDir, entry.name);
  }
  return hooks;
}

/**
 * Validate that all mandatory hooks are present. Abort if any are missing.
 */
function validateMandatoryHooks(hooks) {
  const missing = MANDATORY_HOOKS.filter((h) => !hooks[h]);
  if (missing.length > 0) {
    process.stderr.write(`Error: Missing mandatory hooks: ${missing.join(', ')}\n`);
    process.stderr.write('Run /m:setup or provide them manually in .molcajete/hooks/\n');
    process.exit(1);
  }
}

/**
 * Execute a hook script. Pipes JSON input via stdin, parses JSON output from stdout.
 * @param {string} hookPath - Absolute path to the hook script
 * @param {object} input - JSON payload to send via stdin
 * @param {object} [opts] - Options: timeout (ms)
 * @returns {Promise<{ ok: boolean, data: object, stderr: string }>}
 */
async function runHook(hookPath, input, { timeout = HOOK_TIMEOUT, cwd } = {}) {
  return new Promise((resolveP) => {
    const child = spawn(hookPath, [], {
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const inputJson = JSON.stringify(input);
    child.stdin.write(inputJson);
    child.stdin.end();

    if (DEBUG) {
      const YELLOW = '\x1b[33m';
      const RESET = '\x1b[0m';
      process.stderr.write('\n');
      log(`${YELLOW}$ hook: ${basename(hookPath)}${RESET}`);
      log(`${YELLOW}input: ${inputJson}${RESET}`);
      process.stderr.write('\n');
    }

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString().trim();
      const stderr = Buffer.concat(stderrChunks).toString().trim();

      if (code !== 0) {
        resolveP({ ok: false, data: {}, stderr: stderr || `Hook exited with code ${code}` });
        return;
      }

      try {
        const data = JSON.parse(stdout);
        if (DEBUG) {
          const GRAY = '\x1b[90m';
          const RESET = '\x1b[0m';
          log(`${GRAY}output: ${stdout}${RESET}`);
        }
        resolveP({ ok: true, data, stderr });
      } catch {
        resolveP({ ok: false, data: {}, stderr: `Invalid JSON from hook: ${stdout.slice(0, 200)}` });
      }
    });
  });
}

/**
 * Try to run an optional hook. If the hook doesn't exist, returns null.
 * If it exists, runs it and returns the result.
 */
async function tryHook(hooks, name, input, opts) {
  if (!hooks[name]) return null;
  log(`Running hook: ${name}`);
  return runHook(hooks[name], input, opts);
}

/**
 * Poll health-check hook every 10s until all services report ready or timeout.
 * Prints per-service status each cycle so the user sees progress.
 */
async function pollHealthCheck(hooks, timeoutMs, { cwd } = {}) {
  const intervalMs = 10_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await runHook(hooks['health-check'], {}, { cwd });

    if (result.ok && result.data.status === 'ready') {
      if (result.data.services) {
        for (const [name, status] of Object.entries(result.data.services)) {
          log(`  ${name}: ${status}`);
        }
      }
      log('All services ready');
      return { ok: true };
    }

    // Print current status so user sees progress
    if (result.ok && result.data.services) {
      for (const [name, status] of Object.entries(result.data.services)) {
        log(`  ${name}: ${status}`);
      }
    } else if (!result.ok) {
      log(`  health-check: hook error (${result.stderr.slice(0, 100)})`);
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    log(`Services not ready — retrying in 10s (${remaining}s remaining)`);
    await sleep(intervalMs);
  }

  return { ok: false, error: `Health check timed out after ${Math.round(timeoutMs / 1000)}s` };
}

/**
 * Start environment via start hook (optional) then poll health-check.
 */
async function startEnvironment(hooks, settings, { cwd } = {}) {
  log('Starting environment...');
  const startResult = await tryHook(hooks, 'start', {}, { cwd });
  if (startResult && !startResult.ok) {
    return { ok: false, error: `Start hook failed: ${startResult.stderr}` };
  }
  if (startResult && startResult.data.status === 'failed') {
    return { ok: false, error: startResult.data.summary || 'Start hook reported failure' };
  }

  log('Waiting for services...');
  return pollHealthCheck(hooks, settings.startTimeout, { cwd });
}

/**
 * Stop environment via stop hook (optional).
 */
async function stopEnvironment(hooks, { cwd } = {}) {
  log('Stopping environment...');
  const result = await tryHook(hooks, 'stop', {}, { cwd });
  if (result && !result.ok) {
    log(`Warning: stop hook failed: ${result.stderr}`);
  }
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

function readSettings(projectRoot) {
  const settingsPath = join(projectRoot, '.molcajete', 'settings.json');
  const defaults = { useWorktrees: true, allowParallelTasks: false, startTimeout: 120000 };
  if (!existsSync(settingsPath)) return defaults;
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return {
      useWorktrees: raw.useWorktrees ?? defaults.useWorktrees,
      allowParallelTasks: raw.allowParallelTasks ?? defaults.allowParallelTasks,
      startTimeout: raw.startTimeout ?? defaults.startTimeout,
    };
  } catch { return defaults; }
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
      if (task.scenario) doneTags.add('@' + task.scenario);
      if (task.use_case) implementedUcs.add(task.use_case);
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

// ── Session Stats ──

const buildStats = { totalCostUsd: 0, totalApiMs: 0, totalRealMs: 0, sessions: 0 };

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function extractSessionStats(rawOutput, realMs) {
  try {
    const events = JSON.parse(rawOutput.trim());
    if (!Array.isArray(events)) return null;
    const result = events.find((e) => e.type === 'result');
    if (!result) return null;

    const apiMs = result.duration_api_ms ?? 0;
    const costUsd = result.total_cost_usd ?? 0;

    return {
      apiMs,
      costUsd,
      apiTime: formatDuration(apiMs),
      realTime: formatDuration(realMs),
      realMs,
      cost: `$${costUsd.toFixed(4)}`,
    };
  } catch {
    return null;
  }
}

function logSessionStats(rawOutput, realMs) {
  const stats = extractSessionStats(rawOutput, realMs);
  if (stats) {
    buildStats.totalCostUsd += stats.costUsd;
    buildStats.totalApiMs += stats.apiMs;
    buildStats.totalRealMs += stats.realMs;
    buildStats.sessions++;
    log(`Elapsed: ${stats.apiTime} (Real ${stats.realTime}) | Cost: ${stats.cost}`);
  }
}

// ── invokeClaude ──

async function invokeClaude(workdir, args) {
  for (let attempt = 0; attempt <= 6; attempt++) {
    const result = await spawnClaude(workdir, args);

    if (result.exitCode === 0) {
      logSessionStats(result.output, result.realMs);
      return result;
    }

    if (/rate.limit|429|too many requests/i.test(result.stderr)) {
      const wait = BACKOFF_BASE * 2 ** attempt;
      log(
        `Rate limited. Retrying in ${wait}s (attempt ${attempt + 1}/6)...`
      );
      await sleep(wait * 1000);
      continue;
    }

    logSessionStats(result.output, result.realMs);
    return result;
  }

  log('Rate limit retries exhausted.');
  return { output: '', exitCode: 1 };
}

function spawnClaude(workdir, args) {
  return new Promise((resolveP) => {
    const startTime = Date.now();
    const fullArgs = [
      '-p',
      '--output-format', 'json',
      '--plugin-dir',
      PLUGIN_DIR,
      '--dangerously-skip-permissions',
    ];

    fullArgs.push(...args);

    if (DEBUG) {
      const YELLOW = '\x1b[33m';
      const RESET = '\x1b[0m';
      const quotedArgs = fullArgs.map(shellQuote).join(' ');
      process.stderr.write('\n');
      log(`${YELLOW}$ claude ${quotedArgs}${RESET}`);
      log(`${YELLOW}cwd: ${workdir}${RESET}`);
      process.stderr.write('\n');
    }

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

    const chunks = [];

    child.stdout.on('data', (chunk) => {
      chunks.push(chunk);
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
        realMs: Date.now() - startTime,
      });
    });
  });
}

// ── Output Parsing ──

function extractStructuredOutput(rawOutput) {
  // --output-format json returns a JSON array of events.
  // The result event contains structured_output from --json-schema.
  const trimmed = rawOutput.trim();
  try {
    const events = JSON.parse(trimmed);
    if (Array.isArray(events)) {
      const result = events.find((e) => e.type === 'result');
      if (result?.structured_output) return result.structured_output;
      // Fall back to assistant text content (when no --json-schema)
      const textParts = [];
      for (const e of events) {
        if (e.type === 'assistant' && e.message?.content) {
          for (const c of e.message.content) {
            if (c.type === 'text') textParts.push(c.text);
          }
        }
      }
      if (textParts.length) {
        const text = textParts.join('\n').trim();
        try { return JSON.parse(text); } catch { /* not JSON text */ }
      }
      return {};
    }
    // Not an array — try as raw JSON object
    return events;
  } catch {
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
 * Prepare a worktree for a task. Checks for create-worktree hook first,
 * then falls back to Node.js-first with Claude fallback on error.
 * @returns {{ ok: boolean, path: string, error?: string }}
 */
async function prepareWorktree(hooks, projectRoot, feature, taskId, baseBranch, taskContext = {}) {
  const wtPath = worktreePath(projectRoot, feature, taskId);
  const branch = worktreeBranch(feature, taskId);

  // Lifecycle hook: before-worktree-created
  await tryHook(hooks, 'before-worktree-created', {
    path: wtPath,
    branch,
    base_branch: baseBranch,
    ...taskContext,
  });

  // Try optional create-worktree hook first
  const hookResult = await tryHook(hooks, 'create-worktree', {
    path: wtPath,
    branch,
    base_branch: baseBranch,
    ...taskContext,
  });
  if (hookResult) {
    if (hookResult.ok && hookResult.data.status === 'ok') {
      log(`Worktree ready (hook): ${hookResult.data.path || wtPath}`);
      // Lifecycle hook: after-worktree-created
      await tryHook(hooks, 'after-worktree-created', {
        path: hookResult.data.path || wtPath,
        branch,
        base_branch: baseBranch,
        ...taskContext,
      });
      return { ok: true, path: hookResult.data.path || wtPath };
    }
    if (hookResult.ok && hookResult.data.status === 'failed') {
      return { ok: false, path: wtPath, error: hookResult.data.error || 'create-worktree hook failed' };
    }
    // Hook errored — fall through to built-in
    log('create-worktree hook failed, falling back to built-in');
  }

  mkdirSync(join(projectRoot, '.molcajete', 'worktrees'), { recursive: true });

  // Check for stale worktree
  try {
    const list = run('git worktree list --porcelain', {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    if (list.includes(wtPath)) {
      log(`Removing stale worktree: ${wtPath}`);
      run(`git worktree remove --force "${wtPath}"`, { cwd: projectRoot });
    }
  } catch {
    // ignore — worktree may not exist
  }

  // Clean up stale branch
  try {
    run(`git branch -D "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // branch doesn't exist — fine
  }

  // Create worktree
  try {
    run(
      `git worktree add -b "${branch}" "${wtPath}" "${baseBranch}"`,
      { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' }
    );
    log(`Worktree ready: ${wtPath}`);
    // Lifecycle hook: after-worktree-created
    await tryHook(hooks, 'after-worktree-created', {
      path: wtPath,
      branch,
      base_branch: baseBranch,
      ...taskContext,
    });
    return { ok: true, path: wtPath };
  } catch (err) {
    log(`Worktree creation failed — launching fix session`);
    return await runWorktreeFixSession(projectRoot, wtPath, branch, baseBranch, err.stderr || err.message);
  }
}

/**
 * Clean up a worktree and its branch after merge or failure.
 * Checks for optional cleanup hook first.
 */
async function cleanupWorktree(hooks, projectRoot, feature, taskId, taskContext = {}) {
  const wtPath = worktreePath(projectRoot, feature, taskId);
  const branch = worktreeBranch(feature, taskId);

  // Try optional cleanup hook first
  const hookResult = await tryHook(hooks, 'cleanup', { path: wtPath, branch, ...taskContext });
  if (hookResult?.ok && hookResult.data.status === 'ok') {
    return;
  }

  // Built-in cleanup
  try {
    run(`git worktree remove --force "${wtPath}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // already removed or doesn't exist
  }
  try {
    run(`git branch -d "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // branch already deleted or not merged — try force
    try {
      run(`git branch -D "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
    } catch {
      // truly gone
    }
  }
}

// ── Session Runners ──

/**
 * Run pre-flight checks using health-check and run-tests hooks.
 * @returns {{ ok: boolean, failures: string[], summary: string }}
 */
async function runPreFlight(hooks, planFile) {
  log('Pre-flight: running baseline BDD tests');
  const failures = [];

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
  } else if (testResult.data.status === 'error') {
    failures.push(...(testResult.data.failures || ['Test infrastructure error']));
  } else if (testResult.data.status === 'fail') {
    failures.push(...(testResult.data.failures || ['Pre-flight tests failed']));
  }

  if (failures.length > 0) {
    log(`Pre-flight FAILED: ${failures.join('; ')}`);
    return { ok: false, failures, summary: 'Pre-flight tests failed' };
  }

  const summary = testResult.data.summary || 'All checks green';
  log(`Pre-flight passed: ${summary}`);
  return { ok: true, failures: [], summary };
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
    '--model', 'opus',
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
 * Run validation: format + lint hooks (sequential), then BDD hook (if task-level),
 * then Claude session for code-review + completeness.
 * @param {object} opts - Optional: { filesModified: string[], taskContext: object }
 * @returns {{ ok: boolean, issues: string[], structured: object }}
 */
async function runValidationSession(hooks, projectRoot, planFile, taskId, wtPath, opts = {}) {
  log(`Validation: ${taskId}`);

  const data = readPlan(planFile);
  const isSubTask = isSubTaskId(taskId);
  let task;
  if (isSubTask) {
    const parentId = parentTaskId(taskId);
    task = findTask(data, parentId);
  } else {
    task = findTask(data, taskId);
  }

  const domain = task?.domain || '';
  const services = domain ? [domain, 'bdd'] : ['bdd'];
  const filesModified = opts.filesModified || [];
  const taskContext = opts.taskContext || {};

  const allIssues = [];
  const structured = { formatting: [], linting: [], bdd_tests: [], code_review: [], completeness: [] };

  // ── Hook gates: format then lint (sequential — both modify files) ──

  const fmtResult = await runHook(hooks['format'], { files: filesModified, services, ...taskContext }, { timeout: 60000, cwd: wtPath });
  if (!fmtResult.ok) {
    allIssues.push(`Format hook failed: ${fmtResult.stderr}`);
    structured.formatting.push(`Format hook failed: ${fmtResult.stderr}`);
  } else if (fmtResult.data.status === 'fail') {
    structured.formatting = fmtResult.data.issues || [];
    allIssues.push(...structured.formatting);
  }

  const lintResult = await runHook(hooks['lint'], { files: filesModified, services, ...taskContext }, { timeout: 120000, cwd: wtPath });
  if (!lintResult.ok) {
    allIssues.push(`Lint hook failed: ${lintResult.stderr}`);
    structured.linting.push(`Lint hook failed: ${lintResult.stderr}`);
  } else if (lintResult.data.status === 'fail') {
    structured.linting = lintResult.data.issues || [];
    allIssues.push(...structured.linting);
  }

  // ── BDD hook (task-level only, skipped for sub-tasks and null scenario) ──

  const scenarioTag = task?.scenario ? ['@' + task.scenario] : [];

  if (!isSubTask && scenarioTag.length > 0) {

    const bddResult = await runHook(hooks['run-tests'], {
      tags: scenarioTag,
      scope: 'task',
      ...taskContext,
    }, { timeout: 300000, cwd: wtPath });

    if (!bddResult.ok) {
      allIssues.push(`Run-tests hook failed: ${bddResult.stderr}`);
      structured.bdd_tests.push(`Run-tests hook failed: ${bddResult.stderr}`);
    } else if (bddResult.data.status === 'error') {
      // HARD STOP — test infrastructure is broken, no point running Claude gates
      structured.bdd_tests = bddResult.data.failures || ['Test infrastructure error'];
      allIssues.push(...structured.bdd_tests);

      // Attempt to retrieve logs for debugging setup errors
      const logsResult = await tryHook(hooks, 'logs', { lines: 200 });
      if (logsResult?.ok && logsResult.data.logs) {
        const logSnippet = logsResult.data.logs.slice(0, 2000);
        allIssues.push(`Environment logs:\n${logSnippet}`);
      }

      log(`Validation ${taskId}: BDD setup error — hard stop (skipping Claude gates)`);
      return { ok: false, issues: allIssues, structured, hardStop: true };
    } else if (bddResult.data.status === 'fail') {
      structured.bdd_tests = bddResult.data.failures || [];
      allIssues.push(...structured.bdd_tests);
    }
  }

  // ── Lifecycle hook: before-validate ──

  await tryHook(hooks, 'before-validate', { task_id: taskId, services, ...taskContext });

  // ── Claude gates: code-review + completeness ──

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
  structured.code_review = claudeOut.code_review || [];
  structured.completeness = claudeOut.completeness || [];
  allIssues.push(...structured.code_review, ...structured.completeness);

  // ── Lifecycle hook: after-validate ──

  await tryHook(hooks, 'after-validate', { task_id: taskId, services, gate_results: structured, ...taskContext });

  if (allIssues.length === 0) {
    log(`Validation ${taskId}: all gates passed`);
    return { ok: true, issues: [], structured };
  }

  log(`Validation ${taskId}: ${allIssues.length} issues found`);
  return { ok: false, issues: allIssues, structured };
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
    '--model', 'claude-haiku-4-5',
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
 * Run the final test suite using the run-tests hook (post-flight).
 * @returns {{ ok: boolean, failures: string[] }}
 */
async function runFinalTests(hooks, planFile) {
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
    log(`Final tests: hook error`);
    return { ok: false, failures };
  }

  if (result.data.status === 'pass') {
    log('Final tests: all tests passed');
    return { ok: true, failures: [] };
  }

  const failures = result.data.failures || [`Tests failed: ${result.data.status}`];
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
    '--model', 'claude-haiku-4-5',
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

/**
 * Run a doc session for a task. Non-blocking — failures are warnings.
 */
async function runDocSession(projectRoot, planFile, task, wtPath, devSummary, filesModified) {
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

  const out = extractStructuredOutput(result.output);

  if (result.exitCode === 0 && out.status === 'done') {
    log(`Doc session ${taskId}: ${(out.files_modified || []).length} file(s) updated`);
    return { ok: true, structured: out };
  }

  const error = out.error || 'Doc session failed';
  log(`Doc session ${taskId}: warning — ${error}`);
  return { ok: false, structured: out };
}

/**
 * Commit documentation changes after a doc session.
 */
async function commitDocChanges(wtPath, taskId, docFiles) {
  if (!docFiles || docFiles.length === 0) return { ok: true };

  try {
    for (const f of docFiles) {
      execSync(`git add "${f}"`, { cwd: wtPath, stdio: 'pipe' });
    }

    // Check if there are staged changes
    try {
      execSync('git diff --cached --quiet', { cwd: wtPath, stdio: 'pipe' });
      // No staged changes — nothing to commit
      log(`Doc commit ${taskId}: no changes to commit`);
      return { ok: true };
    } catch {
      // There are staged changes — proceed with commit
    }

    execSync(
      `git commit -m "docs: update documentation for ${taskId}"`,
      { cwd: wtPath, stdio: 'pipe' },
    );
    log(`Doc commit ${taskId}: committed`);
    return { ok: true };
  } catch (err) {
    log(`Doc commit ${taskId}: warning — ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Dev-Validate Cycle ──

/**
 * Build a task context object from plan data for passing to hooks.
 */
function buildTaskContext(data, taskId) {
  const isSubTask = isSubTaskId(taskId);
  let task;
  if (isSubTask) {
    task = findTask(data, parentTaskId(taskId));
  } else {
    task = findTask(data, taskId);
  }
  if (!task) return {};

  const ctx = {};
  if (task.feature) ctx.feature_id = task.feature;
  if (task.use_case) ctx.usecase_id = task.use_case;
  if (task.scenario) ctx.scenario_id = task.scenario;
  return ctx;
}

/**
 * Core dev-validate loop. Runs dev session then validation session,
 * retrying up to MAX_DEV_VALIDATE_CYCLES times.
 *
 * @param {string} taskId - Task or sub-task ID
 * @param {string[]} priorSummaries - Summaries from prior tasks/sub-tasks
 * @returns {{ ok: boolean, devResult: object, validateResult: object, error?: string }}
 */
async function runDevValidateCycle(hooks, projectRoot, planFile, taskId, wtPath, priorSummaries, planDir) {
  let issues = [];

  const data = readPlan(planFile);
  const taskContext = buildTaskContext(data, taskId);

  // Derive branch info for commit hooks
  const isSubTask = isSubTaskId(taskId);
  const parentId = isSubTask ? parentTaskId(taskId) : taskId;
  const task = findTask(data, parentId);
  const baseBranch = data.base_branch || 'main';
  const workingBranch = task ? worktreeBranch(task.feature, parentId) : '';

  for (let cycle = 1; cycle <= MAX_DEV_VALIDATE_CYCLES; cycle++) {
    log(`Dev-validate cycle ${cycle}/${MAX_DEV_VALIDATE_CYCLES} for ${taskId}`);

    // Dev session (no commit)
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
    });

    // Validation session
    const val = await runValidationSession(hooks, projectRoot, planFile, taskId, wtPath, {
      filesModified,
      taskContext,
    });

    // Save validation report
    if (planDir) {
      writeReport(planDir, `${taskId}-validate-${cycle}`, val.structured);
    }

    if (!val.ok) {
      // Hard stop on infrastructure errors — no point retrying code changes
      if (val.hardStop) {
        log(`Cycle ${cycle}: BDD setup error — stopping task (infrastructure is broken)`);
        return {
          ok: false,
          devResult: dev.structured,
          validateResult: val.structured,
          error: `Setup error: ${val.issues.join('; ').slice(0, 500)}`,
        };
      }

      // Feed issues to next dev session
      issues = val.issues;
      log(`Cycle ${cycle} failed with ${issues.length} issues — ${cycle < MAX_DEV_VALIDATE_CYCLES ? 'retrying' : 'exhausted'}`);
      continue;
    }

    // Validation passed — commit session
    const commit = await runCommitSession(
      projectRoot, planFile, taskId, wtPath,
      dev.structured.summary, filesModified
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
      });

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
 * Checks for optional merge hook first, then falls back to Node.js-first
 * with dev-validate fallback on conflicts.
 *
 * @returns {{ ok: boolean, error?: string }}
 */
async function mergeWorktree(hooks, projectRoot, planFile, feature, taskId, baseBranch, priorSummaries, planDir) {
  const wtPath = worktreePath(projectRoot, feature, taskId);
  const branch = worktreeBranch(feature, taskId);

  const data = readPlan(planFile);
  const mergeContext = buildTaskContext(data, taskId);

  // Lifecycle hook: before-worktree-merged
  await tryHook(hooks, 'before-worktree-merged', {
    worktree_path: wtPath,
    branch,
    base_branch: baseBranch,
    ...mergeContext,
  });

  // Try optional merge hook first
  const hookResult = await tryHook(hooks, 'merge', {
    worktree_path: wtPath,
    branch,
    base_branch: baseBranch,
    ...mergeContext,
  });
  if (hookResult) {
    if (hookResult.ok && hookResult.data.status === 'ok') {
      // Hook handled the merge — still need to update plan and cleanup
      const data = readPlan(planFile);
      const task = findTask(data, taskId);
      if (task) {
        task.status = 'implemented';
        writePlan(planFile, data);
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
      });
      await cleanupWorktree(hooks, projectRoot, feature, taskId, mergeContext);
      log(`Merged and cleaned up (hook): ${taskId}`);
      return { ok: true };
    }
    if (hookResult.ok && hookResult.data.status === 'failed') {
      return { ok: false, error: hookResult.data.error || 'merge hook failed' };
    }
    // Hook errored — fall through to built-in
    log('merge hook failed, falling back to built-in');
  }

  // Step 1: Rebase onto base branch
  try {
    run(`git -C "${wtPath}" rebase "${baseBranch}"`, { stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    log(`Rebase conflict for ${taskId} — launching dev session to resolve`);

    // Abort the failed rebase
    try {
      run(`git -C "${wtPath}" rebase --abort`, { stdio: 'pipe' });
    } catch {
      // may already be clean
    }

    // Dev-validate cycle to resolve conflicts
    const resolution = await runDevValidateCycle(
      hooks, projectRoot, planFile, taskId, wtPath,
      [...priorSummaries, `MERGE CONFLICT: Rebase of ${branch} onto ${baseBranch} failed. Resolve conflicts, stage files, and commit.`],
      planDir
    );

    if (!resolution.ok) {
      return { ok: false, error: `Merge conflict resolution failed: ${resolution.error}` };
    }

    // Retry rebase after fix
    try {
      run(`git -C "${wtPath}" rebase "${baseBranch}"`, { stdio: 'pipe', encoding: 'utf8' });
    } catch {
      return { ok: false, error: 'Rebase still failing after conflict resolution' };
    }
  }

  // Step 2: Fast-forward merge
  try {
    run(`git checkout "${baseBranch}"`, { cwd: projectRoot, stdio: 'pipe' });
    run(`git merge --no-edit "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch (err) {
    return { ok: false, error: `Fast-forward merge failed: ${err.message}` };
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
      // plan commit failed — non-fatal, the merge itself succeeded
      log(`Warning: plan commit for ${taskId} failed — plan file may be out of sync`);
    }
  }

  // Lifecycle hook: after-worktree-merged
  await tryHook(hooks, 'after-worktree-merged', {
    worktree_path: wtPath,
    branch,
    base_branch: baseBranch,
    ...mergeContext,
  });

  // Step 4: Cleanup
  await cleanupWorktree(hooks, projectRoot, feature, taskId, mergeContext);
  log(`Merged and cleaned up: ${taskId}`);

  return { ok: true };
}

// ── Task Runners ──

/**
 * Run a simple task (no sub-tasks): dev-validate cycle then merge.
 */
async function runSimpleTask(hooks, projectRoot, planFile, task, baseBranch, priorSummaries, planDir, wtPath) {
  const taskId = task.id;

  const data = readPlan(planFile);
  const taskContext = buildTaskContext(data, taskId);

  // Lifecycle hook: before-task
  await tryHook(hooks, 'before-task', {
    task_id: taskId, intent: task.intent, ...taskContext,
  });

  const result = await runDevValidateCycle(hooks, projectRoot, planFile, taskId, wtPath, priorSummaries, planDir);

  if (!result.ok) {
    await tryHook(hooks, 'after-task', {
      task_id: taskId, status: 'failed', summary: result.error || '', ...taskContext,
    });
    return { ok: false, error: result.error, devResult: result.devResult };
  }

  // Doc session + merge only in worktree mode (wtPath !== projectRoot)
  if (wtPath !== projectRoot) {
    // Doc session (non-blocking)
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

    // Merge
    const merge = await mergeWorktree(hooks, projectRoot, planFile, task.feature, taskId, baseBranch, priorSummaries, planDir);
    if (!merge.ok) {
      await tryHook(hooks, 'after-task', {
        task_id: taskId, status: 'failed', summary: merge.error || '', ...taskContext,
      });
      return { ok: false, error: merge.error, devResult: result.devResult };
    }
  }

  // Lifecycle hook: after-task
  await tryHook(hooks, 'after-task', {
    task_id: taskId, status: 'implemented', summary: result.devResult?.summary || '', ...taskContext,
  });

  return { ok: true, devResult: result.devResult };
}

/**
 * Run a task with sub-tasks: iterate sub-tasks, then task-level validation.
 */
async function runTaskWithSubTasks(hooks, projectRoot, planFile, task, baseBranch, priorSummaries, planDir, wtPath) {
  const taskId = task.id;
  const subTasks = task.sub_tasks;
  const subSummaries = [...priorSummaries];
  const allFilesModified = [];

  const data = readPlan(planFile);
  const taskContext = buildTaskContext(data, taskId);

  // Lifecycle hook: before-task
  await tryHook(hooks, 'before-task', {
    task_id: taskId, intent: task.intent, ...taskContext,
  });

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
    const result = await runDevValidateCycle(hooks, projectRoot, planFile, stId, wtPath, subSummaries, planDir);

    if (!result.ok) {
      updateSubTaskStatus(planFile, stId, 'failed', { errors: [result.error] });
      return { ok: false, error: `Sub-task ${stId} failed: ${result.error}` };
    }

    // Update sub-task as implemented
    updateSubTaskStatus(planFile, stId, 'implemented', {
      summary: result.devResult?.summary || null,
    });

    if (result.devResult?.files_modified) allFilesModified.push(...result.devResult.files_modified);
    if (result.devResult?.summary) subSummaries.push(result.devResult.summary);
    log(`Sub-task ${stId}: implemented`);
  }

  // Task-level validation with BDD (using task ID T-NNN, not sub-task ID)
  log(`Running task-level validation for ${taskId} (with BDD)`);
  let valCycleCount = 0;
  const taskVal = await runValidationSession(hooks, projectRoot, planFile, taskId, wtPath);
  valCycleCount++;
  if (planDir) writeReport(planDir, `${taskId}-validate-${valCycleCount}`, taskVal.structured);

  if (!taskVal.ok) {
    // Hard stop on infrastructure errors — no dev fix can help
    if (taskVal.hardStop) {
      log(`Task-level validation: BDD setup error — stopping task (infrastructure is broken)`);
      return { ok: false, error: `Setup error: ${taskVal.issues.join('; ').slice(0, 500)}` };
    }

    // Task-level validation failed — dev session gets full task scope
    log(`Task-level validation failed for ${taskId} — launching fix cycle`);
    let fixIssues = taskVal.issues;

    for (let cycle = 1; cycle <= MAX_DEV_VALIDATE_CYCLES; cycle++) {
      log(`Task-level fix cycle ${cycle}/${MAX_DEV_VALIDATE_CYCLES} for ${taskId}`);

      const dev = await runDevSession(projectRoot, planFile, taskId, wtPath, subSummaries, fixIssues);
      if (!dev.ok) {
        return { ok: false, error: `Task-level fix failed: ${dev.structured?.error || 'Dev session failed'}` };
      }

      const reVal = await runValidationSession(hooks, projectRoot, planFile, taskId, wtPath);
      valCycleCount++;
      if (planDir) writeReport(planDir, `${taskId}-validate-${valCycleCount}`, reVal.structured);

      if (!reVal.ok) {
        // Hard stop on infrastructure errors in retry cycles too
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

  // Doc session + merge only in worktree mode (wtPath !== projectRoot)
  if (wtPath !== projectRoot) {
    // Doc session (non-blocking)
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

    // Merge
    const merge = await mergeWorktree(hooks, projectRoot, planFile, task.feature, taskId, baseBranch, subSummaries, planDir);
    if (!merge.ok) {
      await tryHook(hooks, 'after-task', {
        task_id: taskId, status: 'failed', summary: merge.error || '', ...taskContext,
      });
      return { ok: false, error: merge.error };
    }
  }

  // Lifecycle hook: after-task
  await tryHook(hooks, 'after-task', {
    task_id: taskId, status: 'implemented', summary: '', ...taskContext,
  });

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

  const projectRoot = run('git rev-parse --show-toplevel', {
    encoding: 'utf8',
  }).trim();

  const planDir = dirname(planFile);
  const planRelative = basename(planDir);

  // Discover and validate hooks
  const hooks = discoverHooks(projectRoot);
  validateMandatoryHooks(hooks);

  await runAllTasksMode(hooks, projectRoot, planRelative, planFile, planDir);
}

// ── Main Orchestrator Loop ──

async function runAllTasksMode(hooks, projectRoot, planName, planFile, planDir) {
  log(`Starting build: all pending tasks from ${planName}`);

  const settings = readSettings(projectRoot);
  log(`Mode: ${settings.useWorktrees ? 'worktree' : 'serial'} | Start timeout: ${Math.round(settings.startTimeout / 1000)}s`);

  // Reset failed tasks back to pending so they are retried
  updatePlanJson(planFile, (d) => {
    for (const t of d.tasks) {
      if (t.status === 'failed') {
        t.status = 'pending';
        t.errors = [];
      }
      // Also reset failed sub-tasks
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

  const data = readPlan(planFile);
  const baseBranch = data.base_branch || 'main';

  // ── Environment startup for pre-flight ──

  const envStart = await startEnvironment(hooks, settings, { cwd: projectRoot });
  if (!envStart.ok) {
    log(`BUILD ABORTED: environment startup failed — ${envStart.error}`);
    updatePlanJson(planFile, (d) => { d.status = 'failed'; });
    process.exit(1);
  }

  // ── Phase 1: Pre-flight ──

  const envCheck = await runPreFlight(hooks, planFile);
  if (!envCheck.ok) {
    log('BUILD ABORTED: pre-flight BDD baseline failed');
    for (const f of envCheck.failures) log(`  - ${f}`);
    await stopEnvironment(hooks, { cwd: projectRoot });
    updatePlanJson(planFile, (d) => { d.status = 'failed'; });
    process.exit(1);
  }

  // In worktree mode, stop environment after pre-flight (will restart per-task)
  if (settings.useWorktrees) {
    await stopEnvironment(hooks, { cwd: projectRoot });
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
        t.errors = ['Dependency failed'];
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

    // Build task context for hook calls
    const freshTaskContext = buildTaskContext(freshData, taskId);

    let wtPath;

    if (settings.useWorktrees) {
      // ── Worktree mode: prepare worktree, start environment per-task ──
      const wt = await prepareWorktree(hooks, projectRoot, freshTask.feature, taskId, baseBranch, freshTaskContext);
      if (!wt.ok) {
        log(`Task ${taskId}: worktree preparation failed`);
        updatePlanJson(planFile, (d) => {
          const t = findTask(d, taskId);
          t.status = 'failed';
          t.errors = [wt.error || 'Worktree preparation failed'];
        });
        failedCount++;
        log(`Task ${taskId}: failed — stopping build`);
        break;
      }
      wtPath = wt.path;

      const taskEnv = await startEnvironment(hooks, settings, { cwd: wtPath });
      if (!taskEnv.ok) {
        log(`Task ${taskId}: environment startup failed — ${taskEnv.error}`);
        updatePlanJson(planFile, (d) => {
          const t = findTask(d, taskId);
          t.status = 'failed';
          t.errors = [taskEnv.error || 'Environment startup failed'];
        });
        await cleanupWorktree(hooks, projectRoot, freshTask.feature, taskId, freshTaskContext);
        failedCount++;
        log(`Task ${taskId}: failed — stopping build`);
        break;
      }
    } else {
      // ── Serial mode: no worktree, use project root ──
      wtPath = projectRoot;
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
      result = await runTaskWithSubTasks(hooks, projectRoot, planFile, freshTask, baseBranch, priorSummaries, planDir, wtPath);
    } else {
      result = await runSimpleTask(hooks, projectRoot, planFile, freshTask, baseBranch, priorSummaries, planDir, wtPath);
    }

    if (result.ok) {
      // Update plan with summary from dev result
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        t.status = 'implemented';
        t.errors = [];
        if (result.devResult?.summary) t.summary = result.devResult.summary;
      });
      doneCount++;
      log(`Task ${taskId}: implemented`);
    } else {
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        t.status = 'failed';
        t.errors = [result.error || 'Task failed'];
      });
      if (settings.useWorktrees) {
        await cleanupWorktree(hooks, projectRoot, freshTask.feature, taskId, freshTaskContext);
      }
      failedCount++;
      log(`Task ${taskId}: failed — stopping build`);
      // Stop per-task environment before breaking
      if (settings.useWorktrees) {
        await stopEnvironment(hooks, { cwd: wtPath });
      }
      break;
    }

    // Stop per-task environment in worktree mode
    if (settings.useWorktrees) {
      await stopEnvironment(hooks, { cwd: wtPath });
    }
  }

  // ── Phase 3: Post-flight ──

  if (failedCount === 0 && doneCount === taskCount) {
    // Start environment for post-flight (worktree mode stopped it per-task)
    if (settings.useWorktrees) {
      const postEnv = await startEnvironment(hooks, settings, { cwd: projectRoot });
      if (!postEnv.ok) {
        log(`Post-flight environment startup failed — ${postEnv.error}`);
        updatePlanJson(planFile, (d) => { d.status = 'failed'; });
        failedCount++;
      }
    }

    if (failedCount === 0) {
      const finalResult = await runFinalTests(hooks, planFile);

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
          const reCheck = await runFinalTests(hooks, planFile);
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
  }

  // Stop environment (serial mode ran it the whole time; worktree mode started it for post-flight)
  await stopEnvironment(hooks, { cwd: projectRoot });

  // Update plan-level status
  updatePlanLevelStatus(planFile, taskCount, doneCount, failedCount);

  // ── Completion Report ──

  log('━━━ Build Complete ━━━');
  log(
    `Implemented: ${doneCount} | Failed: ${failedCount} | Total: ${taskCount}`
  );
  if (buildStats.sessions > 0) {
    log(
      `Build totals: ${buildStats.sessions} sessions | Elapsed: ${formatDuration(buildStats.totalApiMs)} (Real ${formatDuration(buildStats.totalRealMs)}) | Cost: $${buildStats.totalCostUsd.toFixed(4)}`
    );
  }

  process.stdout.write('\nTask Status:\n');
  const finalData = readPlan(planFile);
  for (const task of finalData.tasks) {
    const status = task.status.padEnd(12);
    const error = task.errors?.length ? ` (${task.errors.join('; ')})` : '';
    process.stdout.write(`  ${task.id.padEnd(8)}  ${status} ${task.title}${error}\n`);

    // Print sub-task statuses
    if (task.sub_tasks) {
      for (const st of task.sub_tasks) {
        const stStatus = st.status.padEnd(12);
        const stError = st.errors?.length ? ` (${st.errors.join('; ')})` : '';
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
