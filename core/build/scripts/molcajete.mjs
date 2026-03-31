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

/** Currently spawned child process — killed on SIGINT/SIGTERM. */
let activeChild = null;

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'failed'] },
    commits: { type: 'array', items: { type: 'string' } },
    files_modified: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    key_decisions: { type: 'array', items: { type: 'string' } },
    watch_outs: { type: 'array', items: { type: 'string' } },
    quality_gates: {
      type: 'object',
      properties: {
        formatting: { type: 'string', enum: ['pass', 'fail', 'skip'] },
        linting: { type: 'string', enum: ['pass', 'fail', 'skip'] },
        bdd_tests: { type: 'string', enum: ['pass', 'fail', 'skip'] },
        code_review: { type: 'string', enum: ['pass', 'fail'] },
        completeness: { type: 'string', enum: ['pass', 'fail'] },
      },
    },
    error: { type: ['string', 'null'] },
  },
  required: ['status', 'commits', 'files_modified', 'summary'],
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

// ── Plan File Manipulation ──

function updatePlanStatus(planFile, taskId, newStatus) {
  updatePlanJson(planFile, (data) => {
    const task = findTask(data, taskId);
    if (task) task.status = newStatus;
  });
}

function writePlanSummary(planFile, taskId, summary) {
  updatePlanJson(planFile, (data) => {
    const task = findTask(data, taskId);
    if (task) task.summary = summary;
  });
}

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
 * Resolve a plan name to a file in the plans directory.
 * Tries exact match, stem match, timestamp prefix, then slug substring.
 */
function resolvePlanFile(plansDir, name) {
  const files = readdirSync(plansDir).filter((f) => f.endsWith('.json'));

  const withJson = name.endsWith('.json') ? name : `${name}.json`;
  if (files.includes(withJson)) return join(plansDir, withJson);

  if (files.includes(`${name}.json`)) return join(plansDir, `${name}.json`);

  const byTimestamp = files.filter((f) => f.startsWith(name));
  if (byTimestamp.length === 1) return join(plansDir, byTimestamp[0]);

  const bySlug = files.filter((f) => f.includes(name));
  if (bySlug.length === 1) return join(plansDir, bySlug[0]);

  if (byTimestamp.length > 1 || bySlug.length > 1) {
    const matches = [...new Set([...byTimestamp, ...bySlug])];
    process.stderr.write(
      `Error: ambiguous plan name "${name}". Matches:\n  ${matches.join('\n  ')}\n`
    );
    process.exit(1);
  }

  return null;
}

// ── invokeClaude ──

/**
 * Spawn `claude -p` with rate limit retry.
 */
async function invokeClaude(workdir, args) {
  for (let attempt = 0; attempt <= 6; attempt++) {
    const result = await spawnClaude(workdir, args);

    if (result.exitCode === 0) return result;

    if (/rate.limit|429|too many requests/i.test(result.output)) {
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
      '--plugin-dir',
      PLUGIN_DIR,
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
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

    let lineBuf = '';
    const chunks = [];

    child.stdout.on('data', (chunk) => {
      chunks.push(chunk);

      lineBuf += chunk.toString();
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'assistant' && evt.message?.content) {
            for (const block of evt.message.content) {
              if (block.type === 'text' && block.text) {
                process.stdout.write(`${DIM}${block.text}${RESET}\n`);
              }
            }
          }
        } catch {
          // partial or invalid JSON — skip
        }
      }
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
  const lines = rawOutput.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'result' && evt.structured_output) {
        return evt.structured_output;
      }
    } catch {
      // skip
    }
  }
  return {};
}

// ── Context Session ──

/**
 * Create a context session that pre-loads project files.
 * Returns the session name for forking.
 */
async function createContextSession(projectRoot, planFile) {
  const timestamp = Date.now();
  const sessionName = `ctx-${timestamp}`;

  log(`Creating context session: ${sessionName}`);

  // Check for tooling settings
  const settingsPath = join(projectRoot, '.molcajete/settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (!settings.tooling) {
        log('Warning: .molcajete/settings.json has no tooling config — run /m:setup → "Update tooling only" to configure formatter/linter/test commands');
      }
      if (settings.warnings?.length) {
        for (const w of settings.warnings) {
          log(`Warning: ${w}`);
        }
      }
    } catch { /* ignore parse errors */ }
  } else {
    log('Warning: .molcajete/settings.json not found — run /m:setup to configure project tooling');
  }

  const contextFiles = [
    'prd/PROJECT.md',
    'prd/TECH-STACK.md',
    'prd/DOMAINS.md',
    'CLAUDE.md',
    '.molcajete/settings.json',
  ]
    .filter((f) => existsSync(join(projectRoot, f)))
    .join(', ');

  const prompt = `Read these files and confirm context loaded: ${contextFiles}, ${planFile}`;

  const result = await invokeClaude(projectRoot, [
    '--model',
    'claude-sonnet-4-6',
    '--max-turns',
    '5',
    '--name',
    sessionName,
    prompt,
  ]);

  if (result.exitCode !== 0) {
    log('Warning: context session creation failed — tasks will load context individually');
    return null;
  }

  log(`Context session ready: ${sessionName}`);
  return sessionName;
}

// ── Run Single Task ──

/**
 * Run a single task via /m:build skill.
 */
async function runSingleTask(
  projectRoot,
  planName,
  taskId,
  planFile
) {
  const data = readPlan(planFile);
  const task = findTask(data, taskId);
  if (!task) {
    log(`Error: task ${taskId} not found in plan file`);
    return { success: false };
  }

  const sessionName = `${task.feature}-${taskId}`;

  log(`Running task: ${taskId} — ${task.title} (session: ${sessionName})`);

  const claudeArgs = [
    '--model',
    'claude-sonnet-4-6',
    '--allowedTools',
    'Read,Write,Edit,Glob,Grep,Bash,Agent,AskUserQuestion',
    '--max-turns',
    MAX_TURNS_AGENT,
    '--max-budget-usd',
    BUDGET_AGENT,
    '--json-schema',
    JSON.stringify(TASK_SCHEMA),
    '--name',
    sessionName,
  ];

  claudeArgs.push(`/m:build ${planName} ${taskId}`);

  const result = await invokeClaude(projectRoot, claudeArgs);
  const structured = extractStructuredOutput(result.output);

  if (result.exitCode === 0 && structured.status === 'done') {
    // Verify BDD tests actually passed — reject "done" with failing tests
    const bddGate = structured.quality_gates?.bdd_tests;
    if (bddGate === 'fail') {
      log(`Task ${taskId}: agent reported done but BDD tests are FAILING — rejecting`);
      return {
        success: false,
        structured: {
          ...structured,
          status: 'failed',
          error: 'BDD tests failing — task cannot be marked done with failing tests',
        },
      };
    }
    log(`Task ${taskId}: done`);
    return { success: true, structured };
  }

  const error = structured.error || 'Task agent failed';
  log(`Task ${taskId}: failed (${error})`);
  if (!result.output.trim()) {
    log(`Task ${taskId}: no output captured — claude may have crashed on startup`);
  } else {
    log(`Task ${taskId}: exit code ${result.exitCode}, output length ${result.output.length}`);
  }
  if (result.stderr?.trim()) {
    log(`Task ${taskId} stderr: ${result.stderr.trim().slice(0, 500)}`);
  }
  return { success: false, structured };
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
    const available = readdirSync(plansDir)
      .filter((f) => f.endsWith('.json'))
      .join('\n  ');
    process.stderr.write(
      `Error: plan not found: ${planName}\n\nAvailable plans:\n  ${available || '(none)'}\n`
    );
    process.exit(1);
  }

  const projectRoot = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf8',
  }).trim();

  const planRelative = basename(planFile).replace(/\.json$/, '');

  await runAllTasksMode(projectRoot, planRelative, planFile);
}

async function runAllTasksMode(
  projectRoot,
  planName,
  planFile
) {
  log(`Starting build: all pending tasks from ${planName}`);

  // Reset failed tasks back to pending so they are retried
  updatePlanJson(planFile, (d) => {
    for (const t of d.tasks) {
      if (t.status === 'failed') {
        t.status = 'pending';
        t.error = null;
      }
    }
    if (d.status === 'failed') d.status = 'pending';
  });

  // Create context session for pre-loading project files
  await createContextSession(projectRoot, planFile);

  const data = readPlan(planFile);
  const taskCount = data.tasks.length;
  let doneCount = 0;
  let failedCount = 0;

  // Count already-done tasks
  for (const task of data.tasks) {
    if (task.status === 'implemented') doneCount++;
  }

  for (const task of data.tasks) {
    const taskId = task.id;

    // Skip already completed
    if (task.status === 'implemented') continue;

    // Re-read to get latest status (prior tasks may have changed deps)
    const freshData = readPlan(planFile);
    const freshTask = findTask(freshData, taskId);

    if (freshTask.status === 'implemented') {
      continue;
    }

    log(`━━━ Task: ${taskId} — ${freshTask.title} ━━━`);

    // Check dependencies
    const depResult = checkDependencies(freshData, taskId);

    if (depResult === 1) {
      log(`Skipping ${taskId}: dependency failed`);
      updatePlanJson(planFile, (d) => {
        findTask(d, taskId).status = 'failed';
        findTask(d, taskId).error = 'Dependency failed';
      });
      updatePlanStatus(planFile, taskId, 'failed');
      failedCount++;
      continue;
    }

    if (depResult === 2) {
      log(`Skipping ${taskId}: dependency not yet implemented`);
      continue;
    }

    // Run the task
    const result = await runSingleTask(
      projectRoot,
      planName,
      taskId,
      planFile
    );

    if (result.success && result.structured) {
      const s = result.structured;

      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        t.status = 'implemented';
        t.commits = s.commits || [];
        t.quality_gates = s.quality_gates || null;
        t.error = null;
      });
      updatePlanStatus(planFile, taskId, 'implemented');

      let fullSummary = s.summary || '';
      const keyDecisions = (s.key_decisions || []).join('; ');
      const watchOuts = (s.watch_outs || []).join('; ');
      if (keyDecisions) fullSummary += `\nKey decisions: ${keyDecisions}`;
      if (watchOuts) fullSummary += `\nWatch-outs: ${watchOuts}`;
      if (fullSummary) writePlanSummary(planFile, taskId, fullSummary);

      doneCount++;
      log(`Task ${taskId}: implemented`);
    } else {
      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        t.status = 'failed';
        t.error = result.structured?.error || 'Task agent failed';
      });
      updatePlanStatus(planFile, taskId, 'failed');
      failedCount++;
      log(`Task ${taskId}: failed — dependents will be skipped`);
    }
  }

  // PRD status propagation is handled by the task agent inside each commit.
  // No script-level PRD update needed.

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
